import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { listArchives, reportModels } from '@/lib/year-reset/archive'
import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import Container from '@/models/Container'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import User from '@/models/User'
import ProductInsightOverride from '@/models/ProductInsightOverride'
import ProductInsightSnapshot from '@/models/ProductInsightSnapshot'
import {
  computeInsights,
  type EntryRow,
  type InsightOverride,
  type ProductInsight,
  type SaleRow,
} from '@/lib/product-insights'

export const dynamic = 'force-dynamic'

const DAY = 86_400_000
const HISTORY_DAYS = 180
const DEFAULT_LEAD_TIME = 45

type Source = 'china' | 'india'

interface RawSale {
  _id: mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId | null
  billDate: Date
  customerKey: string
  ctnSold: number
  pcsSold: number
  revenue: number
  cost: number
}

/** Sale lines of one source since `since`, discount-adjusted the same way the P&L report does. */
async function loadSales(archive: string | null, source: Source, since: Date): Promise<RawSale[]> {
  const { SellBillItem } = reportModels(archive)
  return SellBillItem.aggregate<RawSale>([
    { $match: { productSource: source } },
    { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
    { $unwind: '$bill' },
    { $match: { 'bill.billDate': { $gte: since } } },
    {
      $project: {
        productId: source === 'china' ? '$product' : '$indiaProduct',
        billDate: '$bill.billDate',
        customerKey: {
          $cond: [
            '$bill.isCashbook',
            'cashbook',
            {
              $cond: [
                '$bill.isBankSale',
                { $concat: ['bank:', { $ifNull: [{ $toString: { $ifNull: ['$bill.bankAccount', '$bill.companyName'] } }, 'unknown'] }] },
                { $concat: ['co:', { $ifNull: [{ $toString: '$bill.company' }, 'unknown'] }] },
              ],
            },
          ],
        },
        ctnSold: { $ifNull: ['$ctnSold', 0] },
        pcsSold: { $ifNull: ['$pcsSold', 0] },
        revenue: {
          $cond: [
            { $gt: ['$bill.totalAmount', 0] },
            {
              $multiply: [
                { $ifNull: ['$totalAmount', 0] },
                { $divide: [{ $ifNull: ['$bill.grandTotal', '$bill.totalAmount'] }, '$bill.totalAmount'] },
              ],
            },
            { $ifNull: ['$totalAmount', 0] },
          ],
        },
        cost: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$fifoBreakdown', []] } }, 0] },
            {
              $reduce: {
                input: '$fifoBreakdown',
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    { $multiply: [{ $ifNull: ['$$this.finalCost', 0] }, { $ifNull: ['$$this.pcsConsumed', 0] }] },
                  ],
                },
              },
            },
            { $subtract: [{ $ifNull: ['$totalAmount', 0] }, { $ifNull: ['$totalProfit', 0] }] },
          ],
        },
      },
    },
  ])
}

/** Average days from purchase to reaching India, from delivered containers. */
async function measuredLeadTime(): Promise<{ days: number; samples: number } | null> {
  const rows = await Container.aggregate<{ days: number }>([
    { $match: { $or: [{ warehouseDate: { $ne: null } }, { arrivedDate: { $ne: null } }] } },
    { $unwind: '$entries' },
    { $lookup: { from: 'buyingentries', localField: 'entries.buyingEntry', foreignField: '_id', as: 'entry' } },
    { $unwind: '$entry' },
    {
      $project: {
        days: {
          $divide: [{ $subtract: [{ $ifNull: ['$warehouseDate', '$arrivedDate'] }, '$entry.entryDate'] }, DAY],
        },
      },
    },
    { $match: { days: { $gt: 0, $lt: 365 } } },
  ])
  if (rows.length === 0) return null
  return { days: Math.round(rows.reduce((a, r) => a + r.days, 0) / rows.length), samples: rows.length }
}

/** Display names for the customer keys built in loadSales. */
async function customerNames(keys: string[]): Promise<Map<string, string>> {
  const companyIds: string[] = []
  const bankIds: string[] = []
  for (const k of keys) {
    if (k.startsWith('co:') && mongoose.Types.ObjectId.isValid(k.slice(3))) companyIds.push(k.slice(3))
    if (k.startsWith('bank:') && mongoose.Types.ObjectId.isValid(k.slice(5))) bankIds.push(k.slice(5))
  }
  const [companies, banks] = await Promise.all([
    Company.find({ _id: { $in: companyIds } }, { companyName: 1 }).lean(),
    BankAccount.find({ _id: { $in: bankIds } }, { accountName: 1 }).lean(),
  ])
  const names = new Map<string, string>()
  for (const c of companies) names.set(`co:${c._id}`, c.companyName)
  for (const b of banks) names.set(`bank:${b._id}`, `${b.accountName} (bank)`)
  // Bank sales without an account carry a free-text name instead of an id
  for (const k of keys) if (k.startsWith('bank:') && !names.has(k)) names.set(k, `${k.slice(5)} (bank)`)
  return names
}

/** Monday 00:00 UTC of the week containing `d`. */
function weekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7))
  return out
}

/**
 * Store this week's health for every product (overwritten until the week ends),
 * then return each product's last 12 weekly scores.
 */
async function snapshotAndHistory(source: Source, insights: ProductInsight[], now: Date) {
  const thisWeek = weekStart(now)
  if (insights.length > 0) {
    await ProductInsightSnapshot.bulkWrite(
      insights.map((p) => ({
        updateOne: {
          filter: { source, product: new mongoose.Types.ObjectId(p.id), weekStart: thisWeek },
          update: {
            $set: {
              score: p.score,
              label: p.label,
              sold30: p.sold30,
              marginPct: p.marginPct,
              profitPerCbm: p.profitPerCbm,
              availableCtn: p.availableCtn,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    )
  }
  const from = new Date(thisWeek.getTime() - 11 * 7 * DAY)
  const rows = await ProductInsightSnapshot.find(
    { source, weekStart: { $gte: from } },
    { product: 1, weekStart: 1, score: 1, label: 1 }
  )
    .sort({ weekStart: 1 })
    .lean()
  const history = new Map<string, { week: string; score: number | null; label: string }[]>()
  for (const r of rows) {
    const key = String(r.product)
    const list = history.get(key) ?? []
    list.push({ week: r.weekStart.toISOString().slice(0, 10), score: r.score ?? null, label: r.label })
    history.set(key, list)
  }
  return history
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
    const source: Source = searchParams.get('source') === 'india' ? 'india' : 'china'
    const coverDays = Math.min(365, Math.max(7, Number(searchParams.get('coverDays')) || 30))
    const leadParam = Number(searchParams.get('leadTimeDays'))

    await connectDB()
    const now = new Date()
    const since = new Date(now.getTime() - HISTORY_DAYS * DAY)

    const measured = source === 'china' ? await measuredLeadTime() : null
    // India products are bought locally, so their default restock time is short.
    const autoLead = measured?.days ?? (source === 'china' ? DEFAULT_LEAD_TIME : 7)
    const leadTimeDays = leadParam > 0 ? Math.min(365, leadParam) : autoLead

    // A year reset wipes sales from the live database; pull the latest frozen
    // year too so trends don't go blank right after a reset.
    const archives = await listArchives().catch(() => [])
    const recentArchive = archives.find((a) => new Date(a.resetDate).getTime() > since.getTime())
    const salesLists = await Promise.all([
      loadSales(null, source, since),
      recentArchive ? loadSales(recentArchive.name, source, since).catch(() => []) : Promise.resolve([]),
    ])
    const seen = new Set<string>()
    const sales: SaleRow[] = []
    for (const s of salesLists.flat()) {
      const key = String(s._id)
      if (!s.productId || seen.has(key)) continue
      seen.add(key)
      sales.push({
        productId: String(s.productId),
        billDate: new Date(s.billDate),
        customerKey: s.customerKey,
        ctnSold: s.ctnSold ?? 0,
        pcsSold: s.pcsSold ?? 0,
        revenue: s.revenue ?? 0,
        profit: (s.revenue ?? 0) - (s.cost ?? 0),
      })
    }

    const { BuyingEntry, IndiaBuyingEntry } = reportModels(null)
    let products: { _id: mongoose.Types.ObjectId; productName: string; ctnWeightKg?: number | null; ctnCbm?: number | null }[]
    let entries: EntryRow[]
    if (source === 'china') {
      products = await Product.find({}, { productName: 1, ctnWeightKg: 1, ctnCbm: 1 }).lean()
      const raw = await BuyingEntry.find(
        {},
        {
          product: 1, entryDate: 1, totalCtn: 1, qty: 1, cbm: 1, weight: 1, finalCost: 1,
          availableCtn: 1, chinaWarehouseReceived: 1, chinaWarehouseCtn: 1, inTransitCtn: 1,
        }
      ).lean()
      entries = raw.map((e) => ({
        productId: String(e.product),
        entryDate: new Date(e.entryDate),
        totalCtn: e.totalCtn ?? 0,
        qtyPerCtn: e.qty ?? 0,
        cbmPerCtn: e.cbm ?? 0,
        weightPerCtn: e.weight ?? 0,
        finalCost: e.finalCost ?? 0,
        availableCtn: e.availableCtn ?? 0,
        // Same buckets as the products page: factory + China WH + in transit
        pipelineCtn:
          (e.chinaWarehouseReceived === 'no' ? e.totalCtn ?? 0 : e.chinaWarehouseCtn ?? 0) + (e.inTransitCtn ?? 0),
      }))
    } else {
      products = await IndiaProduct.find({}, { productName: 1, ctnWeightKg: 1, ctnCbm: 1 }).lean()
      const raw = await IndiaBuyingEntry.find(
        {},
        { product: 1, entryDate: 1, totalCtn: 1, qty: 1, finalCost: 1, availableCtn: 1 }
      ).lean()
      entries = raw.map((e) => ({
        productId: String(e.product),
        entryDate: new Date(e.entryDate),
        totalCtn: e.totalCtn ?? 0,
        qtyPerCtn: e.qty ?? 0,
        cbmPerCtn: 0,
        weightPerCtn: 0,
        finalCost: e.finalCost ?? 0,
        availableCtn: e.availableCtn ?? 0,
        pipelineCtn: 0,
      }))
    }

    const [names, overrideDocs] = await Promise.all([
      customerNames(Array.from(new Set(sales.map((s) => s.customerKey)))),
      ProductInsightOverride.find({ source }).lean(),
    ])
    const editors = await User.find(
      { _id: { $in: overrideDocs.map((o) => o.updatedBy) } },
      { fullName: 1 }
    ).lean()
    const editorName = new Map(editors.map((u) => [String(u._id), u.fullName]))
    const overrides = new Map<string, InsightOverride>(
      overrideDocs.map((o) => [
        String(o.product),
        {
          tag: o.tag,
          demandAdjustPct: o.demandAdjustPct ?? 0,
          note: o.note,
          updatedAt: o.updatedAt?.toISOString(),
          updatedByName: editorName.get(String(o.updatedBy)),
        },
      ])
    )

    const insights = computeInsights(
      products.map((p) => ({ id: String(p._id), name: p.productName, ctnWeightKg: p.ctnWeightKg, ctnCbm: p.ctnCbm })),
      entries,
      sales,
      { now, leadTimeDays, coverDays, customerNames: names, overrides }
    )

    const history = await snapshotAndHistory(source, insights, now).catch((err) => {
      console.error('Insight snapshot failed:', err)
      return new Map<string, { week: string; score: number | null; label: string }[]>()
    })
    const withHistory = insights.map((p) => {
      const h = history.get(p.id) ?? []
      // Score change against the snapshot about four weeks back (or the oldest one we have)
      const past = h.length > 1 ? h[Math.max(0, h.length - 5)] : null
      return {
        ...p,
        history: h,
        scoreChange: past && past.score != null && p.score != null ? p.score - past.score : null,
        scoreChangeSince: past?.week ?? null,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        source,
        generatedAt: now.toISOString(),
        leadTimeDays,
        leadTimeAuto: autoLead,
        leadTimeMeasured: measured,
        coverDays,
        includesArchive: recentArchive?.name ?? null,
        products: withHistory,
      },
    })
  } catch (error) {
    console.error('Insights report error:', error)
    return NextResponse.json(
      { success: false, error: 'Server error', message: 'Failed to build product insights' },
      { status: 500 }
    )
  }
}
