import BankAccount from '@/models/BankAccount'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import Cash from '@/models/Cash'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import ChinaPerson from '@/models/ChinaPerson'
import Company from '@/models/Company'
import Counter from '@/models/Counter'
import Expense from '@/models/Expense'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'
import IndiaProduct from '@/models/IndiaProduct'
import Investment from '@/models/Investment'
import PaymentReceipt from '@/models/PaymentReceipt'
import Product from '@/models/Product'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'

const CTN_TOL = 0.001
const r2 = (n: number) => Math.round(n * 100) / 100
const r5 = (n: number) => parseFloat(Number(n).toFixed(5))

/**
 * UTC midnight of the reset day. Opening rows are all stamped with this one
 * value: an exact clock time would let a later same-day entry dated midnight
 * sort ahead of the opening balance and make the running total read as nonsense.
 */
export function resetStamp(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0))
}

export interface PlanOptions {
  /** Entries whose in-transit cartons have actually landed. */
  releaseInTransit?: string[]
  /** Bill numbering restarts here; the next bill is 1000 + this + 1. */
  counterSeq?: number
}

export interface LedgerCarry { id: string; name: string; balance: number }

export interface CompanyCarry {
  id: string
  name: string
  oldOpening: number
  billed: number
  received: number
  newOpening: number
}

export interface EntryBefore {
  totalCtn: number; available: number; transit: number; chinaWh: number; sold: number
  totalAmount: number; given: number; lockedCtn: number; lockedAmount: number
}
export interface EntryAfter {
  totalCtn: number; totalQty: number; available: number; transit: number; chinaWh: number
  totalAmount: number; given: number; openingGiven: number; advance: number
  remaining: number; status: 'paid' | 'unpaid' | 'partiallypaid'
  lockedCtn: number; lockedAmount: number; isLocked: boolean
  totalCbm: number; totalWeight: number; rmbInrPurchase: number
  totalCarrying: number; totalExpenseINR: number; finalCost: number; shippingCostPerPiece: number
}
export interface EntryTrim {
  id: string; mark: string; product: string
  before: EntryBefore; after: EntryAfter; releasedFromTransit: number
}
export interface EntryDrop {
  id: string; mark: string; product: string; totalCtn: number; sold: number; lockedAmount: number
}
export interface EntryCarry {
  id: string; openingGiven: number
}
export interface InTransitRow {
  id: string; mark: string; product: string
  transitCtn: number; availableCtn: number; valueInr: number; release: boolean
}

export interface ResetPlan {
  builtAt: string
  resetAt: string
  options: { releaseInTransit: string[]; counterSeq: number }
  ledgers: {
    chinaBank: number
    cash: number
    banks: LedgerCarry[]
    suppliers: LedgerCarry[]
    investors: LedgerCarry[]
  }
  companies: CompanyCarry[]
  china: { drop: EntryDrop[]; trim: EntryTrim[]; carry: EntryCarry[] }
  india: { drop: EntryDrop[]; carry: EntryCarry[] }
  wipe: Record<string, number>
  counter: { from: number; to: number; nextBillNumber: number }
  inTransit: InTransitRow[]
  totals: {
    outstandingCarried: number
    companiesOwing: number
    companiesInCredit: number
    sunkLockedAmount: number
    chinaStockValue: number
    indiaStockValue: number
    documentsRemoved: number
  }
}

/** Sold cartons per entry, read from live FIFO breakdowns rather than stored soldCtn. */
async function soldFromFifo(): Promise<Map<string, number>> {
  const items = await SellBillItem.find({ fifoBreakdown: { $exists: true, $ne: [] } })
    .select('fifoBreakdown')
    .lean()
  const map = new Map<string, number>()
  for (const it of items as { fifoBreakdown?: Record<string, unknown>[] }[]) {
    for (const fb of it.fifoBreakdown ?? []) {
      const raw = fb.buyingEntry ?? fb.buyingEntryId ?? fb.entryId ?? fb.entry
      if (raw == null) continue
      const n = Number(fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0)
      if (!Number.isFinite(n)) continue
      const k = String(raw)
      map.set(k, (map.get(k) ?? 0) + n)
    }
  }
  return map
}

/**
 * Work out exactly what the reset would do, without changing anything.
 *
 * Execute runs on the object this returns, so what you are shown and what
 * happens cannot drift apart. Every balance is read from where the app already
 * reads it — nothing here is recalculated from scratch.
 */
export async function buildPlan(
  at: Date = new Date(),
  options: PlanOptions = {}
): Promise<ResetPlan> {
  const release = new Set(options.releaseInTransit ?? [])
  const counterSeq = options.counterSeq ?? 1000
  const resetAt = resetStamp(at)

  // ── ledgers ───────────────────────────────────────────────────────────
  const [newestChinaBank, cashDoc, accounts, persons, investors] = await Promise.all([
    ChinaBankTransaction.findOne().sort({ createdAt: -1 }).select('balanceAfter').lean(),
    Cash.findOne().lean(),
    BankAccount.find({}).select('accountName type currentBalance').lean(),
    ChinaPerson.find({}).select('name currentBalance').lean(),
    Investment.find({}).select('investorName currentBalance').lean(),
  ])

  const ledgers = {
    chinaBank: r2(newestChinaBank?.balanceAfter ?? 0),
    cash: r2(cashDoc?.balance ?? 0),
    banks: accounts
      .filter((a) => a.type !== 'cash')
      .map((a) => ({ id: String(a._id), name: a.accountName, balance: r2(a.currentBalance ?? 0) })),
    suppliers: persons.map((p) => ({ id: String(p._id), name: p.name, balance: r2(p.currentBalance ?? 0) })),
    investors: investors.map((i) => ({ id: String(i._id), name: i.investorName, balance: r2(i.currentBalance ?? 0) })),
  }

  // ── companies: outstanding folds into the opening balance ─────────────
  const [companies, billedAgg, receivedAgg] = await Promise.all([
    Company.find({}).select('companyName openingBalance').lean(),
    SellBill.aggregate([
      { $match: { company: { $ne: null } } },
      { $group: { _id: '$company', total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
    ]),
    PaymentReceipt.aggregate([{ $group: { _id: '$company', total: { $sum: '$amount' } } }]),
  ])
  const billedMap = new Map(billedAgg.map((r) => [String(r._id), r.total as number]))
  const receivedMap = new Map(receivedAgg.map((r) => [String(r._id), r.total as number]))

  const companyRows: CompanyCarry[] = companies.map((c) => {
    const billed = billedMap.get(String(c._id)) ?? 0
    const received = receivedMap.get(String(c._id)) ?? 0
    const oldOpening = c.openingBalance ?? 0
    return {
      id: String(c._id),
      name: c.companyName,
      oldOpening: r2(oldOpening),
      billed: r2(billed),
      received: r2(received),
      newOpening: r2(billed - received + oldOpening),
    }
  })

  // ── China stock ───────────────────────────────────────────────────────
  const soldMap = await soldFromFifo()
  const entries = await BuyingEntry.find({}).lean()
  const productNames = new Map(
    (await Product.find({}).select('productName').lean()).map((p) => [String(p._id), p.productName])
  )

  const drop: EntryDrop[] = []
  const trim: EntryTrim[] = []
  const carry: EntryCarry[] = []
  const inTransit: InTransitRow[] = []
  let sunkLocked = 0
  let chinaStockValue = 0

  for (const e of entries) {
    const id = String(e._id)
    const sold = soldMap.get(id) ?? 0
    const chinaWh = e.chinaWarehouseCtn ?? 0
    const transitRaw = e.inTransitCtn ?? 0
    const availableRaw = e.availableCtn ?? 0
    const remaining = chinaWh + transitRaw + availableRaw
    const productName = productNames.get(String(e.product)) ?? '—'

    if (remaining >= CTN_TOL && transitRaw > CTN_TOL) {
      inTransit.push({
        id,
        mark: e.mark,
        product: productName,
        transitCtn: r5(transitRaw),
        availableCtn: r5(availableRaw),
        valueInr: r2(transitRaw * (e.qty ?? 0) * (e.finalCost ?? 0)),
        release: release.has(id),
      })
    }

    // Nothing left of it — the whole entry goes, and its China Bank debit stays
    // sunk in the carried balance, which is right: that money was spent.
    if (remaining < CTN_TOL) {
      drop.push({
        id, mark: e.mark, product: productName,
        totalCtn: e.totalCtn ?? 0, sold: r5(sold), lockedAmount: r2(e.lockedAmount ?? 0),
      })
      sunkLocked += e.lockedAmount ?? 0
      continue
    }

    const releasing = release.has(id) ? transitRaw : 0
    const transit = r5(transitRaw - releasing)
    const available = r5(availableRaw + releasing)
    chinaStockValue += available * (e.qty ?? 0) * (e.finalCost ?? 0)

    const advOld = e.hasAdvancePayment ? e.advanceAmount ?? 0 : 0

    // Untouched: nothing sold, nothing released. It still needs the opening
    // figure, or clearing the payment rows collapses givenAmount on the next edit.
    if (sold < CTN_TOL && releasing === 0) {
      carry.push({ id, openingGiven: Math.max(0, r2((e.givenAmount ?? 0) - advOld)) })
      continue
    }

    // ── trim: keep what is left, with identical per-piece economics ──────
    const qty = e.qty ?? 0
    const rate = e.rate ?? 0
    const cbm = e.cbm ?? 0
    const weight = e.weight ?? 0
    const carryingRate = e.carryingRate ?? 0
    const avgRmbRate = e.avgRmbRate ?? 0

    const newTotalCtn = r5(chinaWh + transit + available)
    const totalQty = Math.round(newTotalCtn * qty)
    const totalAmount = Math.round(newTotalCtn * qty * rate)
    const rmbInrRaw = newTotalCtn * qty * rate * avgRmbRate
    const carryingRaw = newTotalCtn * cbm * carryingRate
    const expenseRaw = rmbInrRaw + carryingRaw

    const ratio = (e.totalCtn ?? 0) > 0 ? newTotalCtn / (e.totalCtn as number) : 1
    const advNew = r2(advOld * ratio)
    const given = Math.max(0, r2(totalAmount - (e.remainingAmount ?? 0)))
    const openingGiven = Math.max(0, r2(given - advNew))
    const remainingAmount = r2(totalAmount - given)
    const status: 'paid' | 'unpaid' | 'partiallypaid' =
      totalAmount === 0 ? 'unpaid' : remainingAmount <= 0 ? 'paid' : given === 0 ? 'unpaid' : 'partiallypaid'

    // The lock covered available + sold. Only the part that still exists carries
    // over. Cartons released from transit were never debited, so they stay unlocked.
    const oldLockedCtn = e.lockedCtn ?? 0
    const perCtn = oldLockedCtn > 0 ? (e.lockedAmount ?? 0) / oldLockedCtn : 0
    const newLockedCtn = r5(Math.max(0, oldLockedCtn - sold))
    const newLockedAmount = r2(perCtn * newLockedCtn)
    sunkLocked += (e.lockedAmount ?? 0) - newLockedAmount

    trim.push({
      id, mark: e.mark, product: productName,
      before: {
        totalCtn: e.totalCtn ?? 0,
        available: r5(availableRaw), transit: r5(transitRaw), chinaWh: r5(chinaWh),
        sold: r5(sold), totalAmount: e.totalAmount ?? 0, given: r2(e.givenAmount ?? 0),
        lockedCtn: r5(oldLockedCtn), lockedAmount: r2(e.lockedAmount ?? 0),
      },
      after: {
        totalCtn: newTotalCtn, totalQty, available, transit, chinaWh: r5(chinaWh),
        totalAmount, given, openingGiven, advance: advNew,
        remaining: remainingAmount, status,
        lockedCtn: newLockedCtn, lockedAmount: newLockedAmount,
        isLocked: newLockedCtn > CTN_TOL ? !!e.isLocked : false,
        totalCbm: r5(newTotalCtn * cbm),
        totalWeight: r5(newTotalCtn * weight),
        rmbInrPurchase: r5(rmbInrRaw),
        totalCarrying: r5(carryingRaw),
        totalExpenseINR: r5(expenseRaw),
        finalCost: totalQty > 0 ? r5(expenseRaw / totalQty) : 0,
        shippingCostPerPiece: totalQty > 0 ? r5(carryingRaw / totalQty) : 0,
      },
      releasedFromTransit: r5(releasing),
    })
  }

  // ── India stock ───────────────────────────────────────────────────────
  const indiaEntries = await IndiaBuyingEntry.find({}).lean()
  const indiaNames = new Map(
    (await IndiaProduct.find({}).select('productName').lean()).map((p) => [String(p._id), p.productName])
  )
  const indiaDrop: EntryDrop[] = []
  const indiaCarry: EntryCarry[] = []
  let indiaStockValue = 0

  for (const e of indiaEntries) {
    const available = e.availableCtn ?? 0
    const name = indiaNames.get(String(e.product)) ?? '—'
    if (available < CTN_TOL) {
      indiaDrop.push({
        id: String(e._id), mark: name, product: name,
        totalCtn: e.totalCtn ?? 0, sold: r5((e.totalCtn ?? 0) - available), lockedAmount: 0,
      })
      continue
    }
    const adv = e.hasAdvancePayment ? e.advanceAmount ?? 0 : 0
    indiaCarry.push({ id: String(e._id), openingGiven: Math.max(0, r2((e.givenAmount ?? 0) - adv)) })
    indiaStockValue += available * (e.qty ?? 0) * (e.finalCost ?? 0)
  }

  // ── deleted outright ──────────────────────────────────────────────────
  const [sb, sbi, pr, ex, bp, ibp, counterDoc] = await Promise.all([
    SellBill.countDocuments(),
    SellBillItem.countDocuments(),
    PaymentReceipt.countDocuments(),
    Expense.countDocuments(),
    BuyingPayment.countDocuments(),
    IndiaBuyingPayment.countDocuments(),
    Counter.findById('sellBillNumber').lean(),
  ])
  const wipe = {
    sellbills: sb, sellbillitems: sbi, paymentreceipts: pr,
    expenses: ex, buyingpayments: bp, indiabuyingpayments: ibp,
  }

  return {
    builtAt: new Date().toISOString(),
    resetAt: resetAt.toISOString(),
    options: { releaseInTransit: Array.from(release), counterSeq },
    ledgers,
    companies: companyRows,
    china: { drop, trim, carry },
    india: { drop: indiaDrop, carry: indiaCarry },
    wipe,
    counter: { from: counterDoc?.seq ?? 0, to: counterSeq, nextBillNumber: 1000 + counterSeq + 1 },
    inTransit,
    totals: {
      outstandingCarried: r2(companyRows.reduce((a, c) => a + c.newOpening, 0)),
      companiesOwing: companyRows.filter((c) => c.newOpening > 0.01).length,
      companiesInCredit: companyRows.filter((c) => c.newOpening < -0.01).length,
      sunkLockedAmount: r2(sunkLocked),
      chinaStockValue: r2(chinaStockValue),
      indiaStockValue: r2(indiaStockValue),
      documentsRemoved:
        Object.values(wipe).reduce((a, n) => a + n, 0) + drop.length + indiaDrop.length,
    },
  }
}
