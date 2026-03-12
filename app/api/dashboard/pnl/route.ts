import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBillItem from '@/models/SellBillItem'
import SellBill from '@/models/SellBill'
import Expense from '@/models/Expense'
import PaymentReceipt from '@/models/PaymentReceipt'
import Company from '@/models/Company'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function getDashboardRanges(
  period: Period,
  startDate?: string | null,
  endDate?: string | null
): {
  currentStart: Date
  currentEnd: Date
  previousStart: Date
  previousEnd: Date
  chartFormat: string
} {
  const now = new Date()

  let currentStart: Date
  let currentEnd: Date

  if (period === 'custom') {
    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required for custom period')
    }
    const s = new Date(startDate)
    const e = new Date(endDate)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      throw new Error('Invalid custom date range')
    }
    currentStart = startOfDay(s)
    currentEnd = endOfDay(e)
  } else if (period === 'today') {
    currentStart = startOfDay(now)
    currentEnd = endOfDay(now)
  } else if (period === 'week') {
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    currentStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), diff))
    currentEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), diff + 6))
  } else if (period === 'month') {
    currentStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    currentEnd = endOfDay(lastDay)
  } else {
    // year
    currentStart = startOfDay(new Date(now.getFullYear(), 0, 1))
    const lastDay = new Date(now.getFullYear(), 11, 31)
    currentEnd = endOfDay(lastDay)
  }

  // Previous period range
  let previousStart: Date
  let previousEnd: Date

  if (period === 'today') {
    const yesterday = new Date(currentStart.getTime() - 24 * 60 * 60 * 1000)
    previousStart = startOfDay(yesterday)
    previousEnd = endOfDay(yesterday)
  } else if (period === 'week') {
    previousEnd = new Date(currentStart.getTime() - 1)
    previousStart = new Date(previousEnd.getTime() - 7 * 24 * 60 * 60 * 1000 + 1)
  } else if (period === 'month') {
    const year = currentStart.getFullYear()
    const month = currentStart.getMonth()
    const prevMonthDate = month === 0 ? new Date(year - 1, 11, 1) : new Date(year, month - 1, 1)
    previousStart = startOfDay(prevMonthDate)
    const prevLastDay = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0)
    previousEnd = endOfDay(prevLastDay)
  } else if (period === 'year') {
    previousStart = startOfDay(new Date(currentStart.getFullYear() - 1, 0, 1))
    previousEnd = endOfDay(new Date(currentStart.getFullYear() - 1, 11, 31))
  } else {
    // custom: same duration just before currentStart
    const diffMs = currentEnd.getTime() - currentStart.getTime()
    previousEnd = new Date(currentStart.getTime() - 1)
    previousStart = new Date(previousEnd.getTime() - diffMs)
  }

  const rangeMs = currentEnd.getTime() - currentStart.getTime()
  const rangeDays = rangeMs / (24 * 60 * 60 * 1000) + 1

  let chartFormat: string
  if (period === 'today' || rangeDays <= 1) {
    chartFormat = '%H:00'
  } else if (rangeDays <= 31) {
    chartFormat = '%Y-%m-%d'
  } else if (rangeDays <= 365) {
    chartFormat = '%Y-%m'
  } else {
    chartFormat = '%Y'
  }

  return { currentStart, currentEnd, previousStart, previousEnd, chartFormat }
}

function calcTrend(current: number, previous: number): number {
  if (!previous) return 0
  return ((current - previous) / previous) * 100
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

    const { searchParams } = new URL(req.url)
    const periodParam = (searchParams.get('period') ?? 'month') as Period
    const period: Period = ['today', 'week', 'month', 'year', 'custom'].includes(periodParam)
      ? periodParam
      : 'month'
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()

    const { currentStart, currentEnd, previousStart, previousEnd, chartFormat } =
      getDashboardRanges(period, startDate, endDate)

    await connectDB()
    // Ensure Company model is registered for any populate/aggregation that relies on it
    void Company

    const [
      summaryResult,
      chartResult,
      expensesSum,
      expensesByPeriod,
      topCompaniesAgg,
      recentBillsRaw,
      prevSummaryResult,
      prevExpensesSum,
    ] = await Promise.all([
      // Current summary (revenue, cost, grossProfit)
      SellBillItem.aggregate([
        {
          $lookup: {
            from: 'sellbills',
            localField: 'sellBill',
            foreignField: '_id',
            as: 'bill',
          },
        },
        { $unwind: '$bill' },
        { $match: { 'bill.billDate': { $gte: currentStart, $lte: currentEnd } } },
        {
          $addFields: {
            itemCost: {
              $reduce: {
                input: { $ifNull: ['$fifoBreakdown', []] },
                initialValue: 0,
                in: {
                  $add: ['$$value', { $multiply: ['$$this.finalCost', '$$this.pcsConsumed'] }],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$totalAmount' },
            cost: { $sum: '$itemCost' },
            grossProfit: { $sum: '$totalProfit' },
          },
        },
      ]),
      // Chart: revenue / cost / grossProfit by period label
      SellBillItem.aggregate([
        {
          $lookup: {
            from: 'sellbills',
            localField: 'sellBill',
            foreignField: '_id',
            as: 'bill',
          },
        },
        { $unwind: '$bill' },
        { $match: { 'bill.billDate': { $gte: currentStart, $lte: currentEnd } } },
        {
          $addFields: {
            itemCost: {
              $reduce: {
                input: { $ifNull: ['$fifoBreakdown', []] },
                initialValue: 0,
                in: {
                  $add: ['$$value', { $multiply: ['$$this.finalCost', '$$this.pcsConsumed'] }],
                },
              },
            },
            period: {
              $dateToString: { format: chartFormat, date: '$bill.billDate' },
            },
          },
        },
        {
          $group: {
            _id: '$period',
            revenue: { $sum: '$totalAmount' },
            cost: { $sum: '$itemCost' },
            grossProfit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Current total expenses
      Expense.aggregate([
        { $match: { expenseDate: { $gte: currentStart, $lte: currentEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Expenses by period for chart (to compute net profit line)
      Expense.aggregate([
        { $match: { expenseDate: { $gte: currentStart, $lte: currentEnd } } },
        {
          $group: {
            _id: {
              $dateToString: { format: chartFormat, date: '$expenseDate' },
            },
            total: { $sum: '$amount' },
          },
        },
      ]),
      // Top companies in current period
      SellBillItem.aggregate([
        {
          $lookup: {
            from: 'sellbills',
            localField: 'sellBill',
            foreignField: '_id',
            as: 'bill',
          },
        },
        { $unwind: '$bill' },
        { $match: { 'bill.billDate': { $gte: currentStart, $lte: currentEnd } } },
        {
          $lookup: {
            from: 'companies',
            localField: 'bill.company',
            foreignField: '_id',
            as: 'companyDoc',
          },
        },
        { $unwind: { path: '$companyDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$bill.company',
            name: { $first: '$companyDoc.companyName' },
            revenue: { $sum: '$totalAmount' },
            profit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      // Recent bills (last 5) in current period
      SellBill.find({
        billDate: { $gte: currentStart, $lte: currentEnd },
      })
        .sort({ billDate: -1, createdAt: -1 })
        .limit(5)
        .populate('company', 'companyName')
        .lean(),
      // Previous period summary
      SellBillItem.aggregate([
        {
          $lookup: {
            from: 'sellbills',
            localField: 'sellBill',
            foreignField: '_id',
            as: 'bill',
          },
        },
        { $unwind: '$bill' },
        { $match: { 'bill.billDate': { $gte: previousStart, $lte: previousEnd } } },
        {
          $addFields: {
            itemCost: {
              $reduce: {
                input: { $ifNull: ['$fifoBreakdown', []] },
                initialValue: 0,
                in: {
                  $add: ['$$value', { $multiply: ['$$this.finalCost', '$$this.pcsConsumed'] }],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$totalAmount' },
            cost: { $sum: '$itemCost' },
            grossProfit: { $sum: '$totalProfit' },
          },
        },
      ]),
      // Previous total expenses
      Expense.aggregate([
        { $match: { expenseDate: { $gte: previousStart, $lte: previousEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ])

    const summaryCurrent = summaryResult[0] ?? {
      revenue: 0,
      cost: 0,
      grossProfit: 0,
    }
    const totalExpensesCurrent = expensesSum[0]?.total ?? 0
    const revenueCurrent = summaryCurrent.revenue ?? 0
    const costCurrent = summaryCurrent.cost ?? 0
    const grossProfitCurrent = summaryCurrent.grossProfit ?? 0
    const netProfitCurrent = grossProfitCurrent - totalExpensesCurrent
    const margin =
      revenueCurrent > 0 ? (netProfitCurrent / revenueCurrent) * 100 : 0

    const summaryPrev = prevSummaryResult[0] ?? {
      revenue: 0,
      cost: 0,
      grossProfit: 0,
    }
    const totalExpensesPrev = prevExpensesSum[0]?.total ?? 0
    const revenuePrev = summaryPrev.revenue ?? 0
    const costPrev = summaryPrev.cost ?? 0
    const grossProfitPrev = summaryPrev.grossProfit ?? 0
    const netProfitPrev = grossProfitPrev - totalExpensesPrev

    const expenseByPeriodMap = Object.fromEntries(
      (expensesByPeriod as { _id: string; total: number }[]).map((r) => [
        r._id,
        r.total,
      ])
    )

    const chartData = (chartResult as {
      _id: string
      revenue: number
      cost: number
      grossProfit: number
    }[]).map((r) => {
      const revenue = r.revenue ?? 0
      const cost = r.cost ?? 0
      const grossProfit = r.grossProfit ?? 0
      const expensesForPeriod = expenseByPeriodMap[r._id] ?? 0
      const netProfit = grossProfit - expensesForPeriod
      return {
        label: r._id,
        revenue,
        cost,
        netProfit,
      }
    })

    const topCompanies = (topCompaniesAgg as {
      _id: mongoose.Types.ObjectId
      name?: string
      revenue: number
      profit: number
    }[]).map((r) => ({
      name: r.name ?? '—',
      revenue: r.revenue ?? 0,
      profit: r.profit ?? 0,
    }))

    const recentBills = (recentBillsRaw as {
      _id: mongoose.Types.ObjectId
      billNumber: number
      billDate: Date
      company: { companyName?: string } | mongoose.Types.ObjectId
      totalAmount: number
    }[]).map((b) => ({
      id: String(b._id),
      billNumber: b.billNumber,
      date: b.billDate,
      company:
        (b.company as { companyName?: string })?.companyName ??
        '—',
      amount: b.totalAmount ?? 0,
    }))

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          revenue: revenueCurrent,
          cost: costCurrent,
          grossProfit: grossProfitCurrent,
          expenses: totalExpensesCurrent,
          netProfit: netProfitCurrent,
          margin,
        },
        trends: {
          revenue: calcTrend(revenueCurrent, revenuePrev),
          cost: calcTrend(costCurrent, costPrev),
          grossProfit: calcTrend(grossProfitCurrent, grossProfitPrev),
          expenses: calcTrend(
            totalExpensesCurrent,
            totalExpensesPrev
          ),
          netProfit: calcTrend(netProfitCurrent, netProfitPrev),
        },
        chartData,
        topCompanies,
        recentBills,
      },
    })
  } catch (error) {
    console.error('Dashboard PnL API Error:', error)
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

