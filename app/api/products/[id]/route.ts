import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Product from '@/models/Product'
import BuyingEntry from '@/models/BuyingEntry'
import SellBillItem from '@/models/SellBillItem'
import SellBill from '@/models/SellBill'
import Company from '@/models/Company'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid product id' },
        { status: 400 }
      )
    }

    await connectDB()
    // Ensure referenced models are registered for populate
    void SellBill
    void Company

    const product = await Product.findById(id).lean()
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Product not found' },
        { status: 404 }
      )
    }

    const productId = new mongoose.Types.ObjectId(id)

    const [entryStats, profitAgg, sellingHistory] = await Promise.all([
      BuyingEntry.aggregate([
        { $match: { product: productId } },
        {
          $group: {
            _id: null,
            totalCtn: { $sum: '$totalCtn' },
            inTransitCtn: { $sum: { $ifNull: ['$inTransitCtn', 0] } },
            availableCtnIndia: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'yes'] },
                  '$availableCtn',
                  0,
                ],
              },
            },
            chinaFactoryCtn: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'no'] },
                  '$totalCtn',
                  0,
                ],
              },
            },
            chinaWhCtn: {
              $sum: {
                $cond: [
                  { $eq: ['$chinaWarehouseReceived', 'yes'] },
                  { $ifNull: ['$chinaWarehouseCtn', 0] },
                  0,
                ],
              },
            },
            soldCtn: { $sum: { $ifNull: ['$soldCtn', 0] } },
            totalCbm: { $sum: { $ifNull: ['$totalCbm', 0] } },
            totalWeight: { $sum: { $ifNull: ['$totalWeight', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
      SellBillItem.aggregate([
        { $match: { product: productId } },
        { $group: { _id: null, totalProfit: { $sum: '$totalProfit' } } },
      ]),
      SellBillItem.find({ product: productId })
        .sort({ createdAt: -1 })
        .populate({
          path: 'sellBill',
          populate: { path: 'company', select: 'companyName' },
        })
        .lean(),
    ])

    const stats =
      entryStats[0] ?? {
        totalCtn: 0,
        availableCtnIndia: 0,
        inTransitCtn: 0,
        chinaFactoryCtn: 0,
        chinaWhCtn: 0,
        soldCtn: 0,
        totalCbm: 0,
        totalWeight: 0,
        count: 0,
      }
    const totalCtn = stats.totalCtn ?? 0
    const availableCtn = stats.availableCtnIndia ?? 0
    const totalSoldCtn = stats.soldCtn ?? 0
    const inTransitCtn = stats.inTransitCtn ?? 0
    const chinaFactoryCtn = stats.chinaFactoryCtn ?? 0
    const chinaWhCtn = stats.chinaWhCtn ?? 0
    const totalCbm = stats.totalCbm ?? 0
    const totalWeight = stats.totalWeight ?? 0
    const totalProfit = profitAgg[0]?.totalProfit ?? 0

    const sellingHistoryList = sellingHistory
      .filter((item) => item.sellBill && typeof item.sellBill === 'object')
      .map((item) => {
        const sellBill = item.sellBill as unknown as { _id: mongoose.Types.ObjectId; billNumber: number; billDate: Date; company: { _id: mongoose.Types.ObjectId; companyName: string } }
        const breakdown = (item.fifoBreakdown ?? []) as {
          buyingEntry: mongoose.Types.ObjectId
          ctnConsumed: number
          pcsConsumed: number
          finalCost: number
          profit: number
        }[]
        const totalPcs = breakdown.reduce((sum, b) => sum + (b.pcsConsumed ?? 0), 0)
        const totalCost = breakdown.reduce((sum, b) => sum + (b.finalCost ?? 0) * (b.pcsConsumed ?? 0), 0)
        const weightedFinalCost = totalPcs > 0 ? totalCost / totalPcs : 0
        const marginPercent =
          item.ratePerPcs && item.ratePerPcs > 0
            ? ((item.ratePerPcs - weightedFinalCost) / item.ratePerPcs) * 100
            : 0
        return {
          _id: item._id,
          sellBillId: sellBill._id,
          billNumber: sellBill.billNumber,
          billDate: sellBill.billDate,
          companyId: sellBill.company?._id,
          companyName: sellBill.company?.companyName ?? '—',
          ctnSold: item.ctnSold,
          pcsSold: item.pcsSold,
          ratePerPcs: item.ratePerPcs,
          totalAmount: item.totalAmount,
          totalProfit: item.totalProfit ?? 0,
          fifoNote: item.fifoNote,
          fifoBreakdown: item.fifoBreakdown ?? [],
          weightedFinalCost,
          marginPercent,
          fifoBreakdownCount: breakdown.length,
        }
      })

    return NextResponse.json({
      success: true,
      data: {
        ...product,
        buyingEntriesCount: stats.count,
        totalCtn,
        availableCtn,
        totalSoldCtn,
        chinaWhCtn,
        inTransitCtn,
        chinaFactoryCtn,
        totalCbm,
        totalWeight,
        totalProfit,
        sellingHistory: sellingHistoryList,
      },
    })
  } catch (error) {
    console.error('Product get API Error:', error)
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid product id' },
        { status: 400 }
      )
    }
    const body = await req.json()

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    const product = await Product.findByIdAndUpdate(
      id,
      {
        ...(body.productName != null && { productName: String(body.productName).trim() }),
        ...(body.productDescription !== undefined && { productDescription: body.productDescription?.trim() || undefined }),
        ...(body.productImage !== undefined && { productImage: body.productImage || undefined }),
        updatedBy,
      },
      { new: true, runValidators: true }
    ).lean()

    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Product not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: product })
  } catch (error) {
    console.error('Product update API Error:', error)
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid product id' },
        { status: 400 }
      )
    }

    await connectDB()

    const count = await BuyingEntry.countDocuments({ product: id })
    if (count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete product that has buying entries. Delete buying entries first.',
        },
        { status: 403 }
      )
    }

    const product = await Product.findByIdAndDelete(id)
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Product not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Product delete API Error:', error)
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
