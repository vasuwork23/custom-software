import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import { getReportDateRange } from '@/lib/report-utils'

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
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') ?? 'month'
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()

    const { start, end } = getReportDateRange(period, startDate, endDate)
    await connectDB()

    const summaryAgg = await SellBill.aggregate([
      { $match: { billDate: { $gte: start, $lte: end } } },
      { $group: { _id: null, totalBills: { $sum: 1 }, totalRevenue: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
    ])
    const summary = summaryAgg[0] ?? { totalBills: 0, totalRevenue: 0 }

    const topProducts = await SellBillItem.aggregate([
      { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
      { $unwind: '$bill' },
      { $match: { 'bill.billDate': { $gte: start, $lte: end } } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
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
      { $group: { _id: '$product', productName: { $first: '$productDoc.productName' }, revenue: { $sum: '$adjustedRevenue' }, profit: { $sum: '$adjustedProfit' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ])

    const topCompanies = await SellBillItem.aggregate([
      { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
      { $unwind: '$bill' },
      { $match: { 'bill.billDate': { $gte: start, $lte: end } } },
      { $lookup: { from: 'companies', localField: 'bill.company', foreignField: '_id', as: 'companyDoc' } },
      { $unwind: { path: '$companyDoc', preserveNullAndEmptyArrays: true } },
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
      {
        $group: {
          _id: { company: '$bill.company', bankAccount: '$bill.bankAccount' },
          companyName: {
            $first: {
              $cond: [
                '$bill.company',
                '$companyDoc.companyName',
                { $ifNull: ['$bill.companyName', '—'] },
              ],
            },
          },
          isCashbook: { $first: { $ifNull: ['$bill.isCashbook', false] } },
          isBankSale: { $first: { $ifNull: ['$bill.isBankSale', false] } },
          revenue: { $sum: '$adjustedRevenue' },
          profit: { $sum: '$adjustedProfit' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ])

    const billsAgg = await SellBill.aggregate([
      { $match: { billDate: { $gte: start, $lte: end } } },
      { $lookup: { from: 'companies', localField: 'company', foreignField: '_id', as: 'companyDoc' } },
      { $unwind: { path: '$companyDoc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'sellbillitems', localField: '_id', foreignField: 'sellBill', as: 'items' } },
      {
        $addFields: {
          itemCount: { $size: '$items' },
          totalProfit: {
            $cond: [
              { $gt: ['$totalAmount', 0] },
              {
                $multiply: [
                  { $sum: '$items.totalProfit' },
                  { $divide: [{ $ifNull: ['$grandTotal', '$totalAmount'] }, '$totalAmount'] },
                ],
              },
              { $sum: '$items.totalProfit' },
            ],
          },
        },
      },
      { $sort: { billDate: -1, createdAt: -1 } },
      {
        $project: {
          billNumber: 1, billDate: 1, totalAmount: { $ifNull: ['$grandTotal', '$totalAmount'] }, itemCount: 1, totalProfit: 1,
          companyName: {
            $cond: [
              '$company',
              '$companyDoc.companyName',
              { $ifNull: ['$companyName', '—'] },
            ],
          },
        },
      },
    ])

    const totalBills = summary.totalBills ?? 0
    const totalRevenue = summary.totalRevenue ?? 0
    const totalProfit = billsAgg.reduce((s: number, b: { totalProfit?: number }) => s + (b.totalProfit ?? 0), 0)
    const avgBillValue = totalBills > 0 ? totalRevenue / totalBills : 0

    const bills = billsAgg.map((b: { _id: unknown; billNumber: number; billDate: Date; companyName?: string; totalAmount: number; itemCount: number; totalProfit: number }) => ({
      _id: b._id,
      billNumber: b.billNumber,
      billDate: b.billDate,
      companyName: b.companyName ?? '—',
      productCount: b.itemCount,
      amount: b.totalAmount,
      profit: b.totalProfit,
    }))

    return NextResponse.json({
      success: true,
      data: {
        summary: { totalBills, totalRevenue, totalProfit, avgBillValue },
        topProducts,
        topCompanies,
        bills,
        dateRange: { start, end },
      },
    })
  } catch (error) {
    console.error('Selling report API Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
