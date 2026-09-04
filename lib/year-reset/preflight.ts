import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'
import Investment from '@/models/Investment'
import InvestmentTransaction from '@/models/InvestmentTransaction'
import SellBillItem from '@/models/SellBillItem'

/**
 * Year-end reset pre-flight.
 *
 * STRICTLY READ-ONLY. It reports and blocks; it never repairs. That rule exists
 * because the obvious "repair" for a balance mismatch is to recompute the stored
 * balance from its ledger — and on a ledger whose rows were deleted without
 * rebalancing, that silently destroys the missing money instead of surfacing it.
 */

const TOL = 0.01          // rupees/yuan tolerance
const CTN_TOL = 0.001     // carton tolerance — values are stored to 5 decimals

const r2 = (n: number) => Math.round(n * 100) / 100

export type Severity = 'blocker' | 'warning'

export interface PreflightCheck {
  id: string
  label: string
  severity: Severity
  passed: boolean
  summary: string
  /** Offending records, when the check fails. Capped for readability. */
  details: string[]
}

export interface PreflightReport {
  ranAt: string
  canProceed: boolean
  blockers: number
  warnings: number
  checks: PreflightCheck[]
  scope: Record<string, number>
}

function check(
  id: string,
  label: string,
  severity: Severity,
  details: string[],
  passSummary: string,
  failSummary: (n: number) => string
): PreflightCheck {
  const passed = details.length === 0
  return {
    id,
    label,
    severity,
    passed,
    summary: passed ? passSummary : failSummary(details.length),
    details: details.slice(0, 25),
  }
}

/** Authoritative sold-CTN per China buying entry, taken from live FIFO breakdowns. */
async function soldCtnFromFifo(): Promise<Map<string, number>> {
  const items = await SellBillItem.find({ fifoBreakdown: { $exists: true, $ne: [] } })
    .select('fifoBreakdown')
    .lean()
  const map = new Map<string, number>()
  for (const item of items as { fifoBreakdown?: Record<string, unknown>[] }[]) {
    for (const fb of item.fifoBreakdown ?? []) {
      const raw = fb.buyingEntry ?? fb.buyingEntryId ?? fb.entryId ?? fb.entry
      if (raw == null) continue
      const key = String(raw)
      const ctn = Number(fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0)
      if (!Number.isFinite(ctn)) continue
      map.set(key, (map.get(key) ?? 0) + ctn)
    }
  }
  return map
}

export async function runPreflight(): Promise<PreflightReport> {
  const checks: PreflightCheck[] = []

  // ── 1. China Bank: the balance exists only as the newest row's balanceAfter,
  //       so it must agree with the sum of the whole chain.
  const cbTxs = await ChinaBankTransaction.find({})
    .select('type amount balanceAfter createdAt')
    .sort({ createdAt: 1 })
    .lean()
  const cbNewest = cbTxs.length ? cbTxs[cbTxs.length - 1].balanceAfter ?? 0 : 0
  const cbSum = cbTxs.reduce(
    (acc, t) => acc + (t.type === 'debit' ? -(t.amount ?? 0) : t.amount ?? 0),
    0
  )
  checks.push(
    check(
      'china-bank-chain',
      'China Bank running balance matches its ledger',
      'blocker',
      Math.abs(cbNewest - cbSum) > TOL
        ? [`newest balanceAfter ₹${r2(cbNewest)} vs chain sum ₹${r2(cbSum)} — gap ₹${r2(cbNewest - cbSum)}`]
        : [],
      `₹${r2(cbNewest)} across ${cbTxs.length} rows`,
      () => 'the running balance and the sum of the rows disagree'
    )
  )

  // ── 2. Bank accounts. Cash is excluded: its truth is Cash.balance, and its
  //       BankTransaction ledger only ever received a handful of legacy rows.
  const accounts = await BankAccount.find({}).select('accountName type currentBalance').lean()
  const bankRows: string[] = []
  for (const acc of accounts) {
    if (acc.type === 'cash') continue
    const txs = await BankTransaction.find({ bankAccount: acc._id }).select('type amount').lean()
    const sum = txs.reduce((a, t) => a + (t.type === 'credit' ? t.amount ?? 0 : -(t.amount ?? 0)), 0)
    if (Math.abs((acc.currentBalance ?? 0) - sum) > TOL) {
      bankRows.push(
        `${acc.accountName}: stored ₹${r2(acc.currentBalance ?? 0)} vs ledger ₹${r2(sum)} — gap ₹${r2((acc.currentBalance ?? 0) - sum)}`
      )
    }
  }
  checks.push(
    check('bank-balances', 'Bank balances match their ledgers', 'blocker', bankRows,
      `${accounts.filter((a) => a.type !== 'cash').length} accounts reconciled`,
      (n) => n === 1
        ? '1 account disagrees with its transaction history'
        : `${n} accounts disagree with their transaction history`)
  )

  // ── 3. Cash is stored twice over: the Cash singleton and a mirror on the
  //       cash BankAccount. Both must agree with the CashTransaction ledger.
  const cashDoc = await Cash.findOne().lean()
  const cashBal = cashDoc?.balance ?? 0
  const cashTxs = await CashTransaction.find({}).select('type amount').lean()
  const cashSum = cashTxs.reduce((a, t) => a + (t.type === 'credit' ? t.amount ?? 0 : -(t.amount ?? 0)), 0)
  const cashAcc = accounts.find((a) => a.type === 'cash')
  const cashRows: string[] = []
  if (Math.abs(cashBal - cashSum) > TOL)
    cashRows.push(`Cash.balance ₹${r2(cashBal)} vs cash ledger ₹${r2(cashSum)} — gap ₹${r2(cashBal - cashSum)}`)
  if (cashAcc && Math.abs((cashAcc.currentBalance ?? 0) - cashBal) > TOL)
    cashRows.push(`cash account mirror ₹${r2(cashAcc.currentBalance ?? 0)} vs Cash.balance ₹${r2(cashBal)}`)
  checks.push(
    check('cash-balance', 'Cash agrees across both places it is stored', 'blocker', cashRows,
      `₹${r2(cashBal)} across ${cashTxs.length} rows`,
      (n) => n === 1 ? '1 cash mismatch' : `${n} cash mismatches`)
  )

  // ── 4. Supplier ¥ balances.
  const persons = await ChinaPerson.find({}).select('name currentBalance').lean()
  const personRows: string[] = []
  for (const p of persons) {
    const txs = await ChinaPersonTransaction.find({ chinaPerson: p._id }).select('type amount').lean()
    const sum = txs.reduce((a, t) => a + (t.type === 'pay_in' ? t.amount ?? 0 : -(t.amount ?? 0)), 0)
    if (Math.abs((p.currentBalance ?? 0) - sum) > TOL) {
      personRows.push(`${p.name}: stored ¥${r2(p.currentBalance ?? 0)} vs ledger ¥${r2(sum)}`)
    }
  }
  checks.push(
    check('supplier-balances', 'Supplier ¥ balances match their ledgers', 'blocker', personRows,
      `${persons.length} suppliers reconciled`,
      (n) => n === 1
        ? '1 supplier balance disagrees with its history'
        : `${n} supplier balances disagree with their history`)
  )

  // ── 5. Investors.
  const investments = await Investment.find({}).select('investorName currentBalance').lean()
  const invRows: string[] = []
  for (const inv of investments) {
    const txs = await InvestmentTransaction.find({ investment: inv._id }).select('type amount').lean()
    const sum = txs.reduce((a, t) => a + (t.type === 'add' ? t.amount ?? 0 : -(t.amount ?? 0)), 0)
    if (Math.abs((inv.currentBalance ?? 0) - sum) > TOL) {
      invRows.push(`${inv.investorName}: stored ₹${r2(inv.currentBalance ?? 0)} vs ledger ₹${r2(sum)}`)
    }
  }
  checks.push(
    check('investor-balances', 'Investor balances match their ledgers', 'blocker', invRows,
      `${investments.length} investors reconciled`,
      (n) => n === 1 ? '1 investor balance disagrees' : `${n} investor balances disagree`)
  )

  // ── 6/7. Stock bookkeeping. The trim reads remaining stock from the buckets,
  //         so the buckets have to add up and soldCtn has to match reality.
  const soldMap = await soldCtnFromFifo()
  const chinaEntries = await BuyingEntry.find({})
    .select('mark totalCtn chinaWarehouseCtn inTransitCtn availableCtn soldCtn qty finalCost isLocked lockedCtn lockedAmount givenAmount openingGivenAmount hasAdvancePayment advanceAmount')
    .lean()
  const soldRows: string[] = []
  const bucketRows: string[] = []
  for (const e of chinaEntries) {
    const id = String(e._id)
    const fifoSold = soldMap.get(id) ?? 0
    if (Math.abs((e.soldCtn ?? 0) - fifoSold) > CTN_TOL) {
      soldRows.push(`${e.mark}: soldCtn ${e.soldCtn ?? 0} vs bills ${r2(fifoSold)}`)
    }
    const buckets =
      (e.chinaWarehouseCtn ?? 0) + (e.inTransitCtn ?? 0) + (e.availableCtn ?? 0) + fifoSold
    if (Math.abs((e.totalCtn ?? 0) - buckets) > CTN_TOL) {
      bucketRows.push(`${e.mark}: totalCtn ${e.totalCtn} vs buckets+sold ${r2(buckets)}`)
    }
  }
  checks.push(
    check('sold-ctn', 'Cartons sold match the sell bills', 'blocker', soldRows,
      `${chinaEntries.length} entries agree with their bills`,
      (n) => n === 1
        ? '1 entry disagrees with the sell bills'
        : `${n} entries disagree with the sell bills`)
  )
  checks.push(
    check('carton-buckets', 'Carton buckets add up to the total', 'blocker', bucketRows,
      `${chinaEntries.length} entries balance`,
      (n) => n === 1 ? '1 entry does not add up' : `${n} entries do not add up`)
  )

  // ── 8. The lock invariant. Every lock debits China Bank and every unlock
  //       reverses it, so the locked value must equal debits minus reversals.
  //       This ties the money ledger to the stock records; it can only be
  //       checked before a reset, because afterwards the ledger is one row.
  const lockedSum = chinaEntries
    .filter((e) => e.isLocked)
    .reduce((a, e) => a + (e.lockedAmount ?? 0), 0)
  const debits = cbTxs.filter((t) => t.type === 'debit').reduce((a, t) => a + (t.amount ?? 0), 0)
  const reversals = cbTxs.filter((t) => t.type === 'reversal').reduce((a, t) => a + (t.amount ?? 0), 0)
  const netDebits = debits - reversals
  checks.push(
    check('lock-invariant', 'Locked stock value matches China Bank debits', 'blocker',
      Math.abs(lockedSum - netDebits) > TOL
        ? [`locked ₹${r2(lockedSum)} vs debits−reversals ₹${r2(netDebits)} — gap ₹${r2(lockedSum - netDebits)}`]
        : [],
      `₹${r2(lockedSum)} locked, matching the ledger`,
      () => 'the locked stock value and the China Bank debits disagree')
  )

  // ── 9. givenAmount is derived, so it must equal its parts. If it does not,
  //       carrying it into openingGivenAmount would carry a wrong number.
  const chinaPayments = await BuyingPayment.find({}).select('buyingEntry amount').lean()
  const payByEntry = new Map<string, number>()
  for (const p of chinaPayments) {
    const k = String(p.buyingEntry)
    payByEntry.set(k, (payByEntry.get(k) ?? 0) + (p.amount ?? 0))
  }
  const givenRows: string[] = []
  for (const e of chinaEntries) {
    const paid = payByEntry.get(String(e._id)) ?? 0
    const adv = e.hasAdvancePayment ? e.advanceAmount ?? 0 : 0
    const expected = r2((e.openingGivenAmount ?? 0) + adv + paid)
    if (Math.abs(expected - (e.givenAmount ?? 0)) > TOL) {
      givenRows.push(`${e.mark}: givenAmount ¥${r2(e.givenAmount ?? 0)} vs parts ¥${expected}`)
    }
  }
  checks.push(
    check('given-amount', 'Amounts paid match their payment records', 'blocker', givenRows,
      `${chinaEntries.length} entries reconcile`,
      (n) => n === 1
        ? '1 entry disagrees with its payment records'
        : `${n} entries disagree with their payment records`)
  )

  // ── 10. Payment rows pointing at entries that no longer exist, or missing the
  //        field that decides how a deletion is reversed.
  const chinaEntryIds = new Set(chinaEntries.map((e) => String(e._id)))
  const indiaEntries = await IndiaBuyingEntry.find({}).select('_id availableCtn').lean()
  const indiaEntryIds = new Set(indiaEntries.map((e) => String(e._id)))
  const indiaPayments = await IndiaBuyingPayment.find({})
    .select('buyingEntry amount paymentSource')
    .lean()

  const orphanRows: string[] = []
  for (const p of chinaPayments) {
    if (!chinaEntryIds.has(String(p.buyingEntry)))
      orphanRows.push(
        `China payment ¥${r2(p.amount ?? 0)} (id ${String(p._id)}) points at missing entry ${String(p.buyingEntry)}`
      )
  }
  for (const p of indiaPayments) {
    if (!indiaEntryIds.has(String(p.buyingEntry)))
      orphanRows.push(
        `India payment ₹${r2(p.amount ?? 0)} (id ${String(p._id)}) points at missing entry ${String(p.buyingEntry)}`
      )
  }
  checks.push(
    check('orphan-payments', 'Every payment points at a real entry', 'blocker', orphanRows,
      `${chinaPayments.length + indiaPayments.length} payments all linked`,
      (n) => n === 1
        ? '1 payment points at an entry that no longer exists'
        : `${n} payments point at entries that no longer exist`)
  )

  const sourceRows = indiaPayments
    .filter((p) => p.paymentSource !== 'bank' && p.paymentSource !== 'company')
    .map((p) => `India payment ₹${r2(p.amount ?? 0)} (id ${String(p._id)}) has no payment source`)
  checks.push(
    check('payment-source', 'Every India payment records where the money came from', 'blocker', sourceRows,
      `${indiaPayments.length} payments have a source`,
      (n) => n === 1
        ? '1 payment does not say where the money came from'
        : `${n} payments do not say where the money came from`)
  )

  // ── Informational scope figures. Not a health check — just what the reset
  //     would touch, so the numbers are visible before the preview is built.
  let toDelete = 0
  let toTrim = 0
  let untouched = 0
  let inTransitEntries = 0
  let inTransitCtn = 0
  for (const e of chinaEntries) {
    const remaining = (e.chinaWarehouseCtn ?? 0) + (e.inTransitCtn ?? 0) + (e.availableCtn ?? 0)
    const sold = soldMap.get(String(e._id)) ?? 0
    if (remaining < CTN_TOL) toDelete += 1
    else if (sold > CTN_TOL) toTrim += 1
    else untouched += 1
    if ((e.inTransitCtn ?? 0) > CTN_TOL) {
      inTransitEntries += 1
      inTransitCtn += e.inTransitCtn ?? 0
    }
  }

  const blockers = checks.filter((c) => !c.passed && c.severity === 'blocker').length
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning').length

  return {
    ranAt: new Date().toISOString(),
    canProceed: blockers === 0,
    blockers,
    warnings,
    checks,
    scope: {
      chinaEntriesToDelete: toDelete,
      chinaEntriesToTrim: toTrim,
      chinaEntriesUntouched: untouched,
      indiaEntriesToDelete: indiaEntries.filter((e) => (e.availableCtn ?? 0) < CTN_TOL).length,
      indiaEntriesToKeep: indiaEntries.filter((e) => (e.availableCtn ?? 0) >= CTN_TOL).length,
      inTransitEntries,
      inTransitCtn: r2(inTransitCtn),
    },
  }
}
