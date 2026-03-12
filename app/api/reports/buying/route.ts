import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import { getReportDateRange, getPeriodFormat } from '@/lib/report-utils'

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

    const periodFormat = getPeriodFormat(period)

    const [summary, statusBreakdown, monthlyTrend, entries] = await Promise.all([
      BuyingEntry.aggregate([
        { $match: { entryDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalEntries: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            totalGiven: { $sum: '$givenAmount' },
            totalRemaining: { $sum: '$remainingAmount' },
          },
        },
      ]),
      BuyingEntry.aggregate([
        { $match: { entryDate: { $gte: start, $lte: end } } },
        { $group: { _id: '$currentStatus', count: { $sum: 1 } } },
      ]),
      BuyingEntry.aggregate([
        { $match: { entryDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: periodFormat, date: '$entryDate' } },
            totalAmount: { $sum: '$totalAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      BuyingEntry.aggregate([
        { $match: { entryDate: { $gte: start, $lte: end } } },
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        { $sort: { entryDate: -1 } },
        {
          $project: {
            entryDate: 1,
            product: 1,
            productName: '$productDoc.productName',
            totalCtn: 1,
            totalAmount: 1,
            givenAmount: 1,
            remainingAmount: 1,
            currentStatus: 1,
          },
        },
      ]),
    ])

    const s = summary[0]
    const totalEntries = s?.totalEntries ?? 0
    const totalAmount = s?.totalAmount ?? 0
    const totalGiven = s?.totalGiven ?? 0
    const totalRemaining = s?.totalRemaining ?? 0

    const paymentStatus = statusBreakdown.reduce(
      (acc: Record<string, number>, r: { _id: string; count: number }) => {
        acc[r._id] = r.count
        return acc
      },
      {}
    )

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalEntries,
          totalAmount,
          totalGiven,
          totalRemaining,
        },
        paymentStatus: {
          paid: paymentStatus.paid ?? 0,
          unpaid: paymentStatus.unpaid ?? 0,
          partiallypaid: paymentStatus.partiallypaid ?? 0,
        },
        monthlyTrend,
        entries: entries.map((e: {
          _id: unknown
          entryDate: Date
          product: unknown
          productName?: string
          totalCtn: number
          totalAmount: number
          givenAmount: number
          remainingAmount: number
          currentStatus: string
        }) => ({
          _id: e._id,
          entryDate: e.entryDate,
          productId: e.product,
          productName: e.productName ?? '—',
          totalCtn: e.totalCtn,
          totalAmount: e.totalAmount,
          givenAmount: e.givenAmount,
          remainingAmount: e.remainingAmount,
          currentStatus: e.currentStatus,
        })),
        dateRange: { start, end },
      },
    })
  } catch (error) {
    console.error('Buying report API Error:', error)
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
