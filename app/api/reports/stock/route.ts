import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { reportModels } from '@/lib/year-reset/archive'
import mongoose from 'mongoose'
import { round, roundQty } from '@/lib/round'

export const dynamic = 'force-dynamic'

type SaleTotals = { _id: mongoose.Types.ObjectId; ctn: number; pcs: number; amount: number }
type EntryLite = {
  totalCtn?: number
  availableCtn?: number
  qty?: number
  finalCost?: number
  chinaWarehouseReceived?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Columns of the stock report that need sales: sold CTN, % sold, average cost,
 * average sell and the profit % between those two averages.
 */
function salesColumns({
  chinaTransitCtn,
  indiaReceivedCtn,
  entries,
  sale,
}: {
  chinaTransitCtn: number
  indiaReceivedCtn: number
  entries: EntryLite[]
  sale?: SaleTotals
}) {
  // Average purchase cost per piece, weighted by pieces bought, over every entry that has a cost.
  let costPcs = 0
  let costSum = 0
  for (const e of entries) {
    const cost = Number(e.finalCost) || 0
    const pcs = (Number(e.totalCtn) || 0) * (Number(e.qty) || 0)
    if (cost <= 0 || pcs <= 0) continue
    costPcs += pcs
    costSum += pcs * cost
  }
  const avgCost = costPcs > 0 ? Number((costSum / costPcs).toFixed(5)) : null

  const soldCtn = round2(sale?.ctn ?? 0)
  const soldPcs = sale?.pcs ?? 0
  const avgSell = soldPcs > 0 ? Number(((sale?.amount ?? 0) / soldPcs).toFixed(5)) : null
  const soldPct = indiaReceivedCtn > 0 ? round2((soldCtn / indiaReceivedCtn) * 100) : null
  const profitPct = avgCost && avgSell != null ? round2(((avgSell - avgCost) / avgCost) * 100) : null

  return { chinaTransitCtn, indiaReceivedCtn, soldCtn, soldPct, avgCost, avgSell, profitPct }
}

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
    // No archive parameter means the live database, exactly as before.
    const { BuyingEntry, IndiaBuyingEntry, SellBillItem } = reportModels(
      new URL(req.url).searchParams.get('archive')
    )

    const [byProduct, totals, indiaByProduct, indiaTotals, chinaSales, indiaSales] = await Promise.all([
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
      // All-time sales per China product: CTN, PCS and amount
      SellBillItem.aggregate<SaleTotals>([
        { $match: { productSource: { $ne: 'india' }, product: { $ne: null } } },
        {
          $group: {
            _id: '$product',
            ctn: { $sum: '$ctnSold' },
            pcs: { $sum: '$pcsSold' },
            amount: { $sum: '$totalAmount' },
          },
        },
      ]),
      // All-time sales per India product
      SellBillItem.aggregate<SaleTotals>([
        { $match: { productSource: 'india', indiaProduct: { $ne: null } } },
        {
          $group: {
            _id: '$indiaProduct',
            ctn: { $sum: '$ctnSold' },
            pcs: { $sum: '$pcsSold' },
            amount: { $sum: '$totalAmount' },
          },
        },
      ]),
    ])

    const chinaSalesMap = new Map(chinaSales.map((s) => [String(s._id), s]))
    const indiaSalesMap = new Map(indiaSales.map((s) => [String(s._id), s]))

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
    }[]).map((r) => {
      // Round to 2dp to eliminate floating-point residuals from FIFO division
      const availableCtn = Math.round(r.availableCtn * 100) / 100
      return {
        productId: r._id,
        productName: (r.productName ?? '—') + ' 🇨🇳 China',
        totalCtnBought: r.totalCtnBought,
        availableCtn,
        chinaWarehouse: r.chinaWarehouse,
        inTransit: r.inTransit,
        indiaWarehouse: availableCtn,
        lockedEntries: r.lockedEntries,
      }
    })

    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        const allEntries = (await BuyingEntry.find({ product: row.productId }).lean()) as EntryLite[]
        const entries = allEntries.filter((e) => e.chinaWarehouseReceived === 'yes')

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

        const chinaTransitCtn = round2(row.chinaWarehouse + row.inTransit)
        return {
          ...row,
          availablePcs,
          costPerPiece,
          totalCost,
          ...salesColumns({
            chinaTransitCtn,
            indiaReceivedCtn: round2(Math.max(0, row.totalCtnBought - chinaTransitCtn)),
            entries: allEntries,
            sale: chinaSalesMap.get(String(row.productId)),
          }),
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
      // Round to 2dp to eliminate floating-point residuals from FIFO division
      availableCtn: Math.round(r.availableCtn * 100) / 100,
    }))

    // Enrich India rows with PCS, cost/piece, and total cost (same logic as China)
    const indiaRows = await Promise.all(
      rawIndiaRows.map(async (row) => {
        const entries = (await IndiaBuyingEntry.find({ product: row.productId }).lean()) as EntryLite[]

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
          ...salesColumns({
            chinaTransitCtn: 0,
            indiaReceivedCtn: round2(row.totalCtnBought),
            entries,
            sale: indiaSalesMap.get(String(row.productId)),
          }),
        }
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
