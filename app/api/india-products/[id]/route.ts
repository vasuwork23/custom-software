import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaProduct from '@/models/IndiaProduct'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import SellBillItem from '@/models/SellBillItem'
import SellBill from '@/models/SellBill'
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

    const product = await IndiaProduct.findById(id).lean()
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India product not found' },
        { status: 404 }
      )
    }

    const productId = new mongoose.Types.ObjectId(id)

    const [entryStats, profitAgg, sellingHistory] = await Promise.all([
      IndiaBuyingEntry.aggregate([
        { $match: { product: productId } },
        {
          $group: {
            _id: null,
            totalCtn: { $sum: '$totalCtn' },
            availableCtn: { $sum: '$availableCtn' },
            availablePcs: { $sum: { $multiply: ['$availableCtn', '$qty'] } },
            count: { $sum: 1 },
          },
        },
      ]),
      SellBillItem.aggregate([
        { $match: { indiaProduct: productId } },
        { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
        { $unwind: '$bill' },
        {
          $addFields: {
            itemCost: {
              $reduce: {
                input: { $ifNull: ['$fifoBreakdown', []] },
                initialValue: 0,
                in: { $add: ['$$value', { $multiply: ['$$this.finalCost', '$$this.pcsConsumed'] }] },
              },
            },
            adjustedRevenue: {
              $cond: [
                { $gt: ['$bill.totalAmount', 0] },
                { $multiply: ['$totalAmount', { $divide: [{ $ifNull: ['$bill.grandTotal', '$bill.totalAmount'] }, '$bill.totalAmount'] }] },
                '$totalAmount',
              ],
            },
          },
        },
        { $addFields: { adjustedProfit: { $subtract: ['$adjustedRevenue', '$itemCost'] } } },
        { $group: { _id: null, totalProfit: { $sum: '$adjustedProfit' } } },
      ]),
      SellBillItem.find({ indiaProduct: productId })
        .sort({ createdAt: -1 })
        .populate({
          path: 'sellBill',
          select: 'billNumber billDate company companyName isCashbook isBankSale bankAccount',
          populate: [
            { path: 'company', select: 'companyName' },
            { path: 'bankAccount', select: 'accountName' },
          ],
        })
        .lean(),
    ])

    const stats = entryStats[0] ?? { totalCtn: 0, availableCtn: 0, availablePcs: 0, count: 0 }
    const totalCtn = stats.totalCtn ?? 0
    // Snap tiny float residuals (< 0.001) from FIFO division to zero
    const rawAvailableCtn = stats.availableCtn ?? 0
    const availableCtn = rawAvailableCtn < 0.001 ? 0 : Math.round(rawAvailableCtn * 100) / 100
    const rawAvailablePcs = stats.availablePcs ?? 0
    const availablePcs = rawAvailablePcs < 0.001 ? 0 : Math.round(rawAvailablePcs * 100) / 100
    const totalProfit = Math.round(profitAgg[0]?.totalProfit ?? 0)
    const totalInvested = await IndiaBuyingEntry.aggregate([
      { $match: { product: productId } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]).then((r) => Math.round(r[0]?.total ?? 0))

    const sellingHistoryList = sellingHistory
      .filter((item) => item.sellBill && typeof item.sellBill === 'object')
      .map((item) => {
        const sellBill = item.sellBill as unknown as { _id: mongoose.Types.ObjectId; billNumber: number; billDate: Date; company: { _id: mongoose.Types.ObjectId; companyName: string }; isCashbook: boolean; isBankSale: boolean; companyName?: string; bankAccount?: { _id: mongoose.Types.ObjectId; accountName: string } }
        return {
          _id: item._id,
          sellBillId: sellBill._id,
          billNumber: sellBill.billNumber,
          billDate: sellBill.billDate,
          isCashbook: !!sellBill.isCashbook,
          isBankSale: !!sellBill.isBankSale,
          companyId: sellBill.isCashbook || sellBill.isBankSale ? undefined : sellBill.company?._id,
          companyName: sellBill.isCashbook
            ? 'Cashbook'
            : sellBill.isBankSale
            ? (sellBill.bankAccount?.accountName ?? sellBill.companyName ?? 'Bank Account')
            : (sellBill.company?.companyName ?? '—'),
          ctnSold: item.ctnSold,
          pcsSold: item.pcsSold,
          ratePerPcs: item.ratePerPcs,
          totalAmount: item.totalAmount,
          totalProfit: item.totalProfit ?? 0,
          fifoNote: item.fifoNote,
          fifoBreakdown: item.fifoBreakdown ?? [],
        }
      })

    return NextResponse.json({
      success: true,
      data: {
        ...product,
        buyingEntriesCount: stats.count,
        totalCtn,
        availableCtn,
        availablePcs,
        totalSoldCtn: totalCtn - availableCtn,
        totalInvested,
        totalProfit,
        sellingHistory: sellingHistoryList,
      },
    })
  } catch (error) {
    console.error('India product get API Error:', error)
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

    const product = await IndiaProduct.findByIdAndUpdate(
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
        { success: false, error: 'Not found', message: 'India product not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: product })
  } catch (error) {
    console.error('India product update API Error:', error)
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

    const count = await IndiaBuyingEntry.countDocuments({ product: id })
    if (count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete India product that has buying entries. Delete buying entries first.',
        },
        { status: 403 }
      )
    }

    const product = await IndiaProduct.findByIdAndDelete(id)
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India product not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('India product delete API Error:', error)
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
