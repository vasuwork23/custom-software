import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBillItem from '@/models/SellBillItem'
import SellBill from '@/models/SellBill'
import Company from '@/models/Company'
import Expense from '@/models/Expense'
import PaymentReceipt from '@/models/PaymentReceipt'
import { getReportDateRange, getPeriodFormat } from '@/lib/report-utils'
import mongoose from 'mongoose'
import { grossProfitPct } from '@/lib/calculations'

export const dynamic = 'force-dynamic'

// Reusable $addFields stage to compute adjustedRevenue for each item
// using the bill's grandTotal / totalAmount ratio so bill-level
// discounts (subtract) and extra charges (add) are reflected in revenue.
const adjustedRevenueField = {
  adjustedRevenue: {
    $cond: [
      { $gt: ['$bill.totalAmount', 0] },
      {
        $multiply: [
          '$totalAmount',
          {
            $divide: [
              { $ifNull: ['$bill.grandTotal', '$bill.totalAmount'] },
              '$bill.totalAmount',
            ],
          },
        ],
      },
      '$totalAmount',
    ],
  },
}

// Reusable itemCost $addFields stage
const itemCostField = {
  itemCost: {
    $reduce: {
      input: { $ifNull: ['$fifoBreakdown', []] },
      initialValue: 0,
      in: {
        $add: [
          '$$value',
          { $multiply: ['$$this.finalCost', '$$this.pcsConsumed'] },
        ],
      },
    },
  },
}

// Reusable lookup + unwind for joining SellBillItem → SellBill
const billLookupStages = [
  {
    $lookup: {
      from: 'sellbills',
      localField: 'sellBill',
      foreignField: '_id',
      as: 'bill',
    },
  },
  { $unwind: '$bill' },
]

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
    const withExpenses = searchParams.get('withExpenses') === 'true'

    const { start, end } = getReportDateRange(period, startDate, endDate)
    await connectDB()

    const periodFormat = getPeriodFormat(period)
    const dateMatch = { 'bill.billDate': { $gte: start, $lte: end } }

    const [
      summaryResult,
      chartResult,
      expensesSum,
      expensesByPeriod,
      byProduct,
      byCompany,
      billedByCompany,
      receivedByCompany,
    ] = await Promise.all([
      // ── Summary: revenue (adjusted), cost, grossProfit ──────────────────
      SellBillItem.aggregate([
        ...billLookupStages,
        { $match: dateMatch },
        {
          $addFields: {
            ...itemCostField,
            ...adjustedRevenueField,
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$adjustedRevenue' },
            cost: { $sum: '$itemCost' },
            grossProfit: { $sum: '$totalProfit' },
          },
        },
      ]),

      // ── Chart: group by period ───────────────────────────────────────────
      SellBillItem.aggregate([
        ...billLookupStages,
        { $match: dateMatch },
        {
          $addFields: {
            ...itemCostField,
            ...adjustedRevenueField,
            period: {
              $dateToString: { format: periodFormat, date: '$bill.billDate' },
            },
          },
        },
        {
          $group: {
            _id: '$period',
            revenue: { $sum: '$adjustedRevenue' },
            cost: { $sum: '$itemCost' },
            grossProfit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // ── Total expenses in range ──────────────────────────────────────────
      Expense.aggregate([
        { $match: { expenseDate: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),

      // ── Expenses by period for chart ─────────────────────────────────────
      Expense.aggregate([
        { $match: { expenseDate: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: {
              $dateToString: { format: periodFormat, date: '$expenseDate' },
            },
            total: { $sum: '$amount' },
          },
        },
      ]),

      // ── By product: revenue (adjusted), cost, profit, margin% ────────────
      SellBillItem.aggregate([
        ...billLookupStages,
        { $match: dateMatch },
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        {
          $lookup: {
            from: 'indiaproducts',
            localField: 'indiaProduct',
            foreignField: '_id',
            as: 'indiaProductDoc',
          },
        },
        {
          $addFields: {
            ...itemCostField,
            ...adjustedRevenueField,
            productKey: { $ifNull: ['$product', '$indiaProduct'] },
            source: { $cond: [{ $ifNull: ['$indiaProduct', false] }, 'india', 'china'] },
            productName: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$indiaProductDoc', []] } }, 0] },
                { $arrayElemAt: ['$indiaProductDoc.productName', 0] },
                { $arrayElemAt: ['$productDoc.productName', 0] },
              ],
            },
          },
        },
        {
          $group: {
            _id: { key: '$productKey', source: '$source' },
            productName: { $first: '$productName' },
            revenue: { $sum: '$adjustedRevenue' },
            cost: { $sum: '$itemCost' },
            profit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      // ── By company: revenue (adjusted), profit (period) ──────────────────
      SellBillItem.aggregate([
        ...billLookupStages,
        { $match: dateMatch },
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
          $addFields: {
            ...adjustedRevenueField,
          },
        },
        {
          $group: {
            _id: '$bill.company',
            companyName: { $first: '$companyDoc.companyName' },
            revenue: { $sum: '$adjustedRevenue' },
            profit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      // ── Outstanding: all-time billed vs received ──────────────────────────
      SellBill.aggregate([
        {
          $group: {
            _id: '$company',
            totalBilled: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } },
          },
        },
      ]),
      PaymentReceipt.aggregate([
        { $group: { _id: '$company', totalReceived: { $sum: '$amount' } } },
      ]),
    ])

    // Fetch opening balances for all companies to include in outstanding
    const allCompanies = await Company.find({}, { _id: 1, openingBalance: 1 }).lean()
    const openingBalanceMap = Object.fromEntries(
      allCompanies.map((c) => [String(c._id), c.openingBalance ?? 0])
    )

    void withExpenses // used in query param only; kept for future use

    const summary = summaryResult[0] ?? { revenue: 0, cost: 0, grossProfit: 0 }
    const totalExpenses = expensesSum[0]?.total ?? 0
    const revenue = summary.revenue ?? 0
    const cost = summary.cost ?? 0
    const grossProfit = summary.grossProfit ?? 0
    const netProfit = grossProfit - totalExpenses
    const marginPct = grossProfitPct(revenue, cost)
    const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0

    const productBreakdown = (byProduct as {
      _id: { key: mongoose.Types.ObjectId; source: string }
      productName?: string
      revenue: number
      cost: number
      profit: number
    }[]).map((r) => {
      const badge = r._id?.source === 'india' ? ' 🇮🇳 India' : ' 🇨🇳 China'
      return {
        productId: r._id?.key ?? r._id,
        productName: (r.productName ?? '—') + badge,
        revenue: r.revenue,
        cost: r.cost,
        profit: r.profit,
        marginPct: grossProfitPct(r.revenue, r.cost),
      }
    })

    const billedMap = Object.fromEntries(
      (billedByCompany as { _id: mongoose.Types.ObjectId; totalBilled: number }[]).map((r) => [
        String(r._id),
        r.totalBilled,
      ])
    )
    const receivedMap = Object.fromEntries(
      (receivedByCompany as { _id: mongoose.Types.ObjectId; totalReceived: number }[]).map((r) => [
        String(r._id),
        r.totalReceived,
      ])
    )
    const companyBreakdown = byCompany.map(
      (r: { _id: mongoose.Types.ObjectId; companyName?: string; revenue: number; profit: number }) => {
        const isCashbook = r._id == null
        return {
          companyId: r._id,
          companyName: isCashbook ? '💵 Cashbook' : (r.companyName ?? '—'),
          revenue: r.revenue,
          profit: r.profit,
          // Cashbook bills are paid at point of sale — no outstanding
          outstanding: isCashbook
            ? 0
            : (billedMap[String(r._id)] ?? 0) -
              (receivedMap[String(r._id)] ?? 0) +
              (openingBalanceMap[String(r._id)] ?? 0),
        }
      }
    )

    const expenseByPeriodMap = Object.fromEntries(
      (expensesByPeriod as { _id: string; total: number }[]).map((r) => [r._id, r.total])
    )

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          revenue,
          cost,
          grossProfit,
          totalExpenses,
          netProfit,
          marginPct,
          netMarginPct,
        },
        chart: chartResult.map(
          (r: { _id: string; revenue: number; cost: number; grossProfit: number }) => ({
            period: r._id,
            revenue: r.revenue,
            cost: r.cost,
            grossProfit: r.grossProfit,
            netProfit: r.grossProfit - (expenseByPeriodMap[r._id] ?? 0),
          })
        ),
        byProduct: productBreakdown,
        byCompany: companyBreakdown,
        dateRange: { start, end },
      },
    })
  } catch (error) {
    console.error('PnL report API Error:', error)
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
