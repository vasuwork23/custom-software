import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import PaymentReceipt from '@/models/PaymentReceipt'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import ChinaPerson from '@/models/ChinaPerson'
import Expense from '@/models/Expense'
import Company from '@/models/Company'
import Product from '@/models/Product'
import Container from '@/models/Container'
import mongoose from 'mongoose'

export const revalidate = 300

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function getPeriodRange(period: Period, startDate?: string | null, endDate?: string | null): { start: Date; end: Date } {
  const now = new Date()
  if (period === 'custom' && startDate && endDate) {
    const s = new Date(startDate)
    const e = new Date(endDate)
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      return { start: startOfDay(s), end: endOfDay(e) }
    }
  }
  if (period === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) }
  }
  if (period === 'week') {
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), diff))
    const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), diff + 6))
    return { start, end }
  }
  if (period === 'year') {
    const start = startOfDay(new Date(now.getFullYear(), 0, 1))
    const end = endOfDay(new Date(now.getFullYear(), 11, 31))
    return { start, end }
  }
  // default month
  const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const end = endOfDay(lastDay)
  return { start, end }
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
    const { start, end } = getPeriodRange(period, startDate, endDate)

    await connectDB()
    // Ensure referenced models are registered for populate calls
    void Product
    void Company

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const [
      chinaBankLastTx,
      cashAccount,
      billedAgg,
      receivedAgg,
      pendingChina,
      pendingIndia,
      chinaInventoryAgg,
      indiaInventoryAgg,
      chinaBankDebitsThisMonth,
      readyToLockCount,
      periodBoughtAgg,
      periodSoldAgg,
      topProductsAgg,
      jackPersons,
      bankAccounts,
      receiptsThisMonth,
      expensesThisMonth,
      monthlyRevenueAgg,
      monthlyExpensesAgg,
      outstandingPerCompanyAgg,
      oldestBillPerCompany,
      deadStockAgg,
      unsentWhatsappCount,
      unlockedReadyEntriesCount,
      containersActiveCount,
      containersInTransitCount,
      containersCustomsCount,
      containersOverdueEtaCount,
    ] = await Promise.all([
      ChinaBankTransaction.findOne()
        .sort({ createdAt: -1 })
        .select('balanceAfter')
        .lean(),
      BankAccount.findOne({ type: 'cash', isDefault: true })
        .select('currentBalance')
        .lean(),
      SellBill.aggregate([
        { $group: { _id: null, totalBilled: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
      ]),
      PaymentReceipt.aggregate([
        { $group: { _id: '$company', totalReceived: { $sum: '$amount' } } },
      ]),
      BuyingEntry.countDocuments({
        currentStatus: { $in: ['unpaid', 'partiallypaid'] },
      }),
      IndiaBuyingEntry.countDocuments({
        currentStatus: { $in: ['unpaid', 'partiallypaid'] },
      }),
      // China inventory in India warehouse (available for selling)
      // Round PCS to integer first (matches stock report's roundQty = Math.round)
      BuyingEntry.aggregate([
        {
          $match: {
            chinaWarehouseReceived: 'yes',
            availableCtn: { $gt: 0 },
          },
        },
        {
          $project: {
            value: {
              $multiply: [
                { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] },
                { $ifNull: ['$finalCost', 0] },
              ],
            },
          },
        },
        { $group: { _id: null, total: { $sum: '$value' } } },
      ]),
      // India inventory (finalCost === rate for India entries)
      // Round PCS to integer first (matches stock report's roundQty = Math.round)
      IndiaBuyingEntry.aggregate([
        {
          $match: {
            availableCtn: { $gt: 0 },
          },
        },
        {
          $project: {
            value: {
              $multiply: [
                { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] },
                '$finalCost',
              ],
            },
          },
        },
        { $group: { _id: null, total: { $sum: '$value' } } },
      ]),
      // China bank debits this month
      ChinaBankTransaction.aggregate([
        {
          $match: {
            type: 'debit',
            transactionDate: { $gte: monthStart, $lte: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Entries ready to lock
      BuyingEntry.countDocuments({
        avgRmbRate: { $gt: 0 },
        carryingRate: { $gt: 0 },
        isLocked: false,
      }),
      // CTN bought this period
      BuyingEntry.aggregate([
        {
          $match: {
            entryDate: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, ctn: { $sum: '$totalCtn' } } },
      ]),
      // CTN sold this period
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
        { $match: { 'bill.billDate': { $gte: start, $lte: end } } },
        { $group: { _id: null, ctn: { $sum: '$ctnSold' } } },
      ]),
      // Top products this period
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
        { $match: { 'bill.billDate': { $gte: start, $lte: end } } },
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
            unitsSold: '$pcsSold',
            source: {
              $cond: [{ $ifNull: ['$indiaProduct', false] }, 'india', 'china'],
            },
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
            _id: { key: { $ifNull: ['$product', '$indiaProduct'] }, source: '$source' },
            name: { $first: '$productName' },
            unitsSold: { $sum: '$unitsSold' },
            revenue: { $sum: '$totalAmount' },
            profit: { $sum: '$totalProfit' },
          },
        },
        {
          $addFields: {
            margin: {
              $cond: [
                { $gt: ['$revenue', 0] },
                { $multiply: [{ $divide: ['$profit', '$revenue'] }, 100] },
                0,
              ],
            },
          },
        },
        { $sort: { profit: -1 } },
        { $limit: 5 },
      ]),
      ChinaPerson.find({}).select('name currentBalance isDefault').lean(),
      BankAccount.find({}).select('accountName currentBalance type').sort({ type: 1, isDefault: -1, accountName: 1 }).lean(),
      PaymentReceipt.aggregate([
        {
          $match: {
            paymentDate: { $gte: monthStart, $lte: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            expenseDate: { $gte: monthStart, $lte: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Monthly revenue / cost / profit last 6 months
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
        { $match: { 'bill.billDate': { $gte: sixMonthsAgo, $lte: monthEnd } } },
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
            month: {
              $dateToString: { format: '%Y-%m', date: '$bill.billDate' },
            },
          },
        },
        {
          $group: {
            _id: '$month',
            revenue: { $sum: '$totalAmount' },
            cost: { $sum: '$itemCost' },
            profit: { $sum: '$totalProfit' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Expense.aggregate([
        {
          $match: {
            expenseDate: { $gte: sixMonthsAgo, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$expenseDate' },
            },
            expenses: { $sum: '$amount' },
          },
        },
      ]),
      // Outstanding per company (all-time)
      SellBill.aggregate([
        {
          $group: {
            _id: '$company',
            totalBilled: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } },
          },
        },
      ]),
      PaymentReceipt.aggregate([
        {
          $group: {
            _id: '$company',
            totalReceived: { $sum: '$amount' },
          },
        },
      ]),
      // Oldest bill per company
      SellBill.aggregate([
        {
          $group: {
            _id: '$company',
            oldestBillDate: { $min: '$billDate' },
          },
        },
      ]),
      // Dead stock (China entries in India warehouse, no sales in 30+ days)
      (async () => {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        const salesAgg = await SellBillItem.aggregate([
          {
            $lookup: {
              from: 'sellbills',
              localField: 'sellBill',
              foreignField: '_id',
              as: 'bill',
            },
          },
          { $unwind: '$bill' },
          { $match: { 'bill.billDate': { $lte: now } } },
          { $unwind: '$fifoBreakdown' },
          {
            $group: {
              _id: '$fifoBreakdown.buyingEntry',
              lastSaleDate: { $max: '$bill.billDate' },
            },
          },
        ])
        const lastSaleMap = new Map<string, Date>()
        for (const s of salesAgg) {
          if (s._id) lastSaleMap.set(String(s._id), s.lastSaleDate as Date)
        }
        const candidates = await BuyingEntry.find({
          chinaWarehouseReceived: 'yes',
          availableCtn: { $gt: 0 },
        })
          .populate('product', 'productName')
          .lean()

        const dead: {
          productName: string
          availableCtn: number
          inventoryValue: number
          daysSinceLastSale: number
        }[] = []
        for (const entry of candidates as any[]) {
          const lastSale = lastSaleMap.get(String(entry._id))
          if (!lastSale || lastSale < thirtyDaysAgo) {
            const days = lastSale
              ? Math.floor(
                  (now.getTime() - lastSale.getTime()) /
                    (24 * 60 * 60 * 1000)
                )
              : 999
            const rawValue =
              (entry.availableCtn ?? 0) *
              (entry.qty ?? 0) *
              (entry.finalCost ?? 0)
            const value =
              Number.isFinite(rawValue) && !Number.isNaN(rawValue) ? rawValue : 0
            dead.push({
              productName:
                (entry.product as { productName?: string })?.productName ??
                '—',
              availableCtn: entry.availableCtn ?? 0,
              inventoryValue: value,
              daysSinceLastSale: days,
            })
          }
        }
        dead.sort((a, b) => b.inventoryValue - a.inventoryValue)
        return dead.slice(0, 10)
      })(),
      SellBill.countDocuments({ whatsappSent: false }),
      BuyingEntry.countDocuments({
        avgRmbRate: { $gt: 0 },
        carryingRate: { $gt: 0 },
        isLocked: false,
      }),
      Container.countDocuments({ status: { $in: ['loading', 'in_transit', 'customs_clearance', 'arrived'] } }),
      Container.countDocuments({ status: 'in_transit' }),
      Container.countDocuments({ status: 'customs_clearance' }),
      Container.countDocuments({
        status: { $in: ['in_transit', 'customs_clearance'] },
        estimatedArrival: { $lt: now },
      }),
    ])

    const chinaBankBalance = chinaBankLastTx?.balanceAfter ?? 0
    const cashBalance = cashAccount?.currentBalance ?? 0
    // receivedAgg is now per-company; sum up for global total
    const totalReceived = (receivedAgg as { _id: unknown; totalReceived: number }[]).reduce(
      (sum, r) => sum + (r.totalReceived ?? 0),
      0
    )
    const totalBilled = billedAgg[0]?.totalBilled ?? 0
    const pendingPaymentsCount = Number(pendingChina) + Number(pendingIndia)

    const chinaInventory = chinaInventoryAgg[0]?.total ?? 0
    const indiaInventory = indiaInventoryAgg[0]?.total ?? 0
    const inventoryValue = {
      total: chinaInventory + indiaInventory,
      chinaProducts: chinaInventory,
      indiaProducts: indiaInventory,
    }

    const chinaBankHealth = {
      balance: chinaBankBalance,
      lockedThisMonth: chinaBankDebitsThisMonth[0]?.total ?? 0,
      readyToLock: readyToLockCount ?? 0,
    }

    const stockMovement = {
      ctnBoughtThisPeriod: periodBoughtAgg[0]?.ctn ?? 0,
      ctnSoldThisPeriod: periodSoldAgg[0]?.ctn ?? 0,
    }

    const topProducts = (topProductsAgg as {
      _id: { key: mongoose.Types.ObjectId; source: string }
      name?: string
      unitsSold: number
      revenue: number
      profit: number
      margin: number
    }[]).map((r) => ({
      name:
        (r.name ?? '—') +
        (r._id?.source === 'india' ? ' 🇮🇳 India' : ' 🇨🇳 China'),
      unitsSold: r.unitsSold ?? 0,
      profit: r.profit ?? 0,
      margin: r.margin ?? 0,
    }))

    const jackBalances = (jackPersons as {
      name: string
      currentBalance?: number
      isDefault?: boolean
    }[]).map((p) => ({
      name: p.name,
      balance: p.currentBalance ?? 0,
      isDefault: Boolean(p.isDefault),
    }))

    const bankBalances = (bankAccounts as {
      accountName: string
      currentBalance?: number
      type: string
      _id: mongoose.Types.ObjectId
    }[]).map((a) => ({
      accountName: a.accountName,
      balance: a.currentBalance ?? 0,
      type: a.type,
      id: String(a._id),
    }))

    const moneyIn = receiptsThisMonth[0]?.total ?? 0
    const moneyOut = expensesThisMonth[0]?.total ?? 0
    const netCashFlow = moneyIn - moneyOut
    const cashFlow = {
      moneyIn,
      moneyOut,
      netCashFlow,
    }

    const expensesByMonth = new Map<string, number>()
    for (const e of expensesThisMonth as { _id: string; expenses: number }[]) {
      expensesByMonth.set(e._id, e.expenses)
    }
    const monthlyComparison = (monthlyRevenueAgg as {
      _id: string
      revenue: number
      cost: number
      profit: number
    }[]).map((m) => {
      const expenses = expensesByMonth.get(m._id) ?? 0
      const netProfit = (m.profit ?? 0) - expenses
      const margin =
        m.revenue > 0 ? (netProfit / m.revenue) * 100 : 0
      return {
        month: m._id,
        revenue: m.revenue ?? 0,
        cost: m.cost ?? 0,
        profit: m.profit ?? 0,
        expenses,
        netProfit,
        margin,
      }
    })

    const billedMap = new Map<string, number>()
    for (const r of outstandingPerCompanyAgg as {
      _id: mongoose.Types.ObjectId
      totalBilled: number
    }[]) {
      billedMap.set(String(r._id), r.totalBilled ?? 0)
    }
    const receivedMap = new Map<string, number>()
    for (const r of receivedAgg as {
      _id: mongoose.Types.ObjectId
      totalReceived: number
    }[]) {
      receivedMap.set(String(r._id), r.totalReceived ?? 0)
    }
    const oldestBillMap = new Map<string, Date>()
    for (const r of oldestBillPerCompany as {
      _id: mongoose.Types.ObjectId
      oldestBillDate: Date
    }[]) {
      oldestBillMap.set(String(r._id), r.oldestBillDate)
    }

    let within30Days = 0
    let days30to60 = 0
    let over60Days = 0
    const agingCompanies: {
      name: string
      outstanding: number
      oldestBillDate: Date
      daysPending: number
    }[] = []

    // Fetch companies with openingBalance to compute accurate outstanding split
    const companies = await Company.find({}).select('companyName openingBalance').lean()

    const companyNameMap = new Map<string, string>()
    const openingBalanceMap = new Map<string, number>()
    for (const c of companies as { _id: mongoose.Types.ObjectId; companyName?: string; openingBalance?: number }[]) {
      companyNameMap.set(String(c._id), c.companyName ?? '—')
      openingBalanceMap.set(String(c._id), c.openingBalance ?? 0)
    }

    // Compute positive/negative outstanding per company (matches companies page logic)
    const epsilon = 0.00001
    let totalPositiveOutstanding = 0
    let totalNegativeOutstanding = 0

    // Collect all company IDs from both billed and opening balance maps
    // Skip 'null' key — cashbook bills (company = null) have no receivable outstanding
    const allCompanyIds = new Set([...billedMap.keys(), ...openingBalanceMap.keys()])
    allCompanyIds.forEach((companyId) => {
      if (!companyId || companyId === 'null') return
      const billed = billedMap.get(companyId) ?? 0
      const received = receivedMap.get(companyId) ?? 0
      const openingBalance = openingBalanceMap.get(companyId) ?? 0
      const outstanding = billed - received + openingBalance
      if (outstanding > epsilon) totalPositiveOutstanding += outstanding
      else if (outstanding < -epsilon) totalNegativeOutstanding += Math.abs(outstanding)
    })

    const totalOutstanding = totalPositiveOutstanding - totalNegativeOutstanding

    billedMap.forEach((billed, companyId) => {
      if (!companyId || companyId === 'null') return  // skip cashbook bills
      const received = receivedMap.get(companyId) ?? 0
      const openingBalance = openingBalanceMap.get(companyId) ?? 0
      const outstanding = billed - received + openingBalance
      if (outstanding <= 0) return
      const oldestBillDate = oldestBillMap.get(companyId)
      if (!oldestBillDate) return
      const days = Math.floor(
        (now.getTime() - oldestBillDate.getTime()) /
          (24 * 60 * 60 * 1000)
      )
      if (days <= 30) within30Days += outstanding
      else if (days <= 60) days30to60 += outstanding
      else over60Days += outstanding
      agingCompanies.push({
        name: companyNameMap.get(companyId) ?? '—',
        outstanding,
        oldestBillDate,
        daysPending: days,
      })
    })

    agingCompanies.sort((a, b) => b.outstanding - a.outstanding)

    const outstandingAging = {
      within30Days,
      days30to60,
      over60Days,
      companies: agingCompanies.slice(0, 5),
    }

    const deadStock = deadStockAgg as {
      productName: string
      availableCtn: number
      inventoryValue: number
      daysSinceLastSale: number
    }[]

    return NextResponse.json({
      success: true,
      data: {
        chinaBankBalance,
        cashBalance,
        totalOutstanding,
        totalPositiveOutstanding,
        totalNegativeOutstanding,
        pendingPaymentsCount,
        inventoryValue,
        chinaBankHealth,
        stockMovement,
        topProducts,
        jackBalances,
        bankBalances,
        cashFlow,
        monthlyComparison,
        outstandingAging,
        deadStock,
        unsentWhatsappBills: unsentWhatsappCount ?? 0,
        unlockedReadyEntries: unlockedReadyEntriesCount ?? 0,
        containers: {
          active: containersActiveCount ?? 0,
          inTransit: containersInTransitCount ?? 0,
          atCustoms: containersCustomsCount ?? 0,
          overdueEta: containersOverdueEtaCount ?? 0,
        },
      },
    })
  } catch (error) {
    console.error('Dashboard stats API Error:', error)
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

