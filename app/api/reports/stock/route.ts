import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import mongoose from 'mongoose'
import { round, roundQty } from '@/lib/round'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    await connectDB()

    const [byProduct, totals, indiaByProduct, indiaTotals] = await Promise.all([
      BuyingEntry.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$product',
            productName: { $first: '$productDoc.productName' },
            qtyPerCtn: { $first: '$qty' },
            totalCtnBought: { $sum: '$totalCtn' },
            availableCtn: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'yes'] },
                  '$availableCtn',
                  0,
                ],
              },
            },
            chinaWarehouse: { $sum: '$chinaWarehouseCtn' },
            inTransit: { $sum: '$inTransitCtn' },
            lockedEntries: { $sum: { $cond: ['$isLocked', 1, 0] } },
          },
        },
        { $sort: { productName: 1 } },
      ]),
      BuyingEntry.aggregate([
        {
          $group: {
            _id: null,
            totalProducts: { $addToSet: '$product' },
            totalAvailableCtn: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'yes'] },
                  '$availableCtn',
                  0,
                ],
              },
            },
            inTransit: { $sum: '$inTransitCtn' },
            inChina: { $sum: '$chinaWarehouseCtn' },
            inIndia: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'yes'] },
                  '$availableCtn',
                  0,
                ],
              },
            },
          },
        },
      ]),
      // India products stock
      IndiaBuyingEntry.aggregate([
        {
          $lookup: {
            from: 'indiaproducts',
            localField: 'product',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$product',
            productName: { $first: '$productDoc.productName' },
            totalCtnBought: { $sum: '$totalCtn' },
            availableCtn: { $sum: '$availableCtn' },
          },
        },
        { $sort: { productName: 1 } },
      ]),
      IndiaBuyingEntry.aggregate([
        {
          $group: {
            _id: null,
            totalProducts: { $addToSet: '$product' },
            totalAvailableCtn: { $sum: '$availableCtn' },
          },
        },
      ]),
    ])

    const totalProducts = totals[0]?.totalProducts?.length ?? 0
    const totalAvailableCtn = totals[0]?.totalAvailableCtn ?? 0
    const totalInTransit = totals[0]?.inTransit ?? 0
    const totalInChina = totals[0]?.inChina ?? 0
    const totalInIndia = totals[0]?.inIndia ?? 0

    const rows = (byProduct as {
      _id: mongoose.Types.ObjectId
      productName?: string
      qtyPerCtn?: number
      totalCtnBought: number
      availableCtn: number
      chinaWarehouse: number
      inTransit: number
      lockedEntries: number
    }[]).map((r) => ({
      productId: r._id,
      productName: (r.productName ?? '—') + ' 🇨🇳 China',
      totalCtnBought: r.totalCtnBought,
      availableCtn: r.availableCtn,
      chinaWarehouse: r.chinaWarehouse,
      inTransit: r.inTransit,
      indiaWarehouse: r.availableCtn,
      lockedEntries: r.lockedEntries,
    }))

    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        const entries = await BuyingEntry.find({
          product: row.productId,
          chinaWarehouseReceived: 'yes',
        }).lean()

        for (const entry of entries) {
          // debug logs removed
        }

        let availablePcs = 0
        let totalCostRaw = 0
        let weightedNumerator = 0
        let weightedDenominator = 0

        for (const entry of entries) {
          const avail = Number(entry.availableCtn) || 0
          const qtyPerCtn = Number(entry.qty) || 0
          const pcs = roundQty(avail * qtyPerCtn)
          availablePcs += pcs

          const cost = Number(entry.finalCost) || 0
          if (cost <= 0) continue

          totalCostRaw += pcs * cost
          weightedNumerator += pcs * cost
          weightedDenominator += pcs
        }

        const costPerPiece =
          weightedDenominator > 0
            ? Number((weightedNumerator / weightedDenominator).toFixed(5))
            : 0

        const totalCost = Number(totalCostRaw.toFixed(2))

        return {
          ...row,
          availablePcs,
          costPerPiece,
          totalCost,
        }
      })
    )

    const rawIndiaRows = (indiaByProduct as {
      _id: mongoose.Types.ObjectId
      productName?: string
      totalCtnBought: number
      availableCtn: number
    }[]).map((r) => ({
      productId: r._id,
      productName: (r.productName ?? '—') + ' 🇮🇳 India',
      totalCtnBought: r.totalCtnBought,
      availableCtn: r.availableCtn,
    }))

    // Enrich India rows with PCS, cost/piece, and total cost (same logic as China)
    const indiaRows = await Promise.all(
      rawIndiaRows.map(async (row) => {
        const entries = await IndiaBuyingEntry.find({ product: row.productId }).lean()

        let availablePcs = 0
        let totalCostRaw = 0
        let weightedNumerator = 0
        let weightedDenominator = 0

        for (const entry of entries) {
          const avail = Number(entry.availableCtn) || 0
          const qtyPerCtn = Number(entry.qty) || 0
          const pcs = roundQty(avail * qtyPerCtn)
          availablePcs += pcs

          const cost = Number(entry.finalCost) || 0
          if (cost <= 0) continue

          totalCostRaw += pcs * cost
          weightedNumerator += pcs * cost
          weightedDenominator += pcs
        }

        const costPerPiece =
          weightedDenominator > 0
            ? Number((weightedNumerator / weightedDenominator).toFixed(5))
            : 0
        const totalCost = Number(totalCostRaw.toFixed(2))

        return { ...row, availablePcs, costPerPiece, totalCost }
      })
    )

    const totalIndiaProducts = indiaTotals[0]?.totalProducts?.length ?? 0
    const totalIndiaAvailableCtn = indiaTotals[0]?.totalAvailableCtn ?? 0
    const totalIndiaAvailablePcs = indiaRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0)
    const totalIndiaStockCost = Number(
      indiaRows.reduce((s, r) => s + (r.totalCost ?? 0), 0).toFixed(2)
    )

    const grandTotalCost = Number(
      enrichedRows.reduce((s, r) => s + (r.totalCost ?? 0), 0).toFixed(2)
    )

    const totalsSummary = {
      totalProducts,
      totalAvailableCtn,
      totalInTransit,
      totalInChina,
      totalInIndia,
      totalAvailablePcs: enrichedRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0),
      totalStockCost: grandTotalCost,
      totalIndiaProducts,
      totalIndiaAvailableCtn,
      totalIndiaAvailablePcs,
      totalIndiaStockCost,
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: totalsSummary,
        rows: enrichedRows,
        indiaRows,
      },
    })
  } catch (error) {
    console.error('Stock report API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
