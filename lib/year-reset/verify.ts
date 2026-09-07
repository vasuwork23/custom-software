import { Db, ObjectId } from 'mongodb'
import type { ResetPlan } from '@/lib/year-reset/plan'

const TOL = 0.01
const CTN_TOL = 0.001
const r2 = (n: number) => Math.round(n * 100) / 100

export interface VerifyResult {
  passed: boolean
  checked: number
  failures: string[]
}

type Row = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Prove the finished database matches the plan, before anything is swapped in.
 *
 * This runs against the staging copy, so a failure costs nothing — the copy is
 * thrown away and live was never touched.
 */
export async function verifyAgainstPlan(db: Db, plan: ResetPlan): Promise<VerifyResult> {
  const fail: string[] = []
  let checked = 0
  const eq = (label: string, expected: number, got: number, tol = TOL) => {
    checked += 1
    if (Math.abs(expected - got) > tol) {
      fail.push(`${label}: expected ${r2(expected)}, got ${r2(got)}`)
    }
  }
  const oid = (s: string) => new ObjectId(s)

  // ── China Bank: the balance is the newest row, and the chain must agree ──
  const cbRows = (await db.collection('chinabanktransactions').find({}).sort({ createdAt: 1 }).toArray()) as Row[]
  checked += 1
  if (cbRows.length !== 1) fail.push(`china bank: expected exactly 1 opening row, found ${cbRows.length}`)
  const cbNewest = cbRows.length ? num(cbRows[cbRows.length - 1].balanceAfter) : 0
  const cbSum = cbRows.reduce((a, t) => a + (t.type === 'debit' ? -num(t.amount) : num(t.amount)), 0)
  eq('china bank balance', plan.ledgers.chinaBank, cbNewest)
  eq('china bank chain sum', plan.ledgers.chinaBank, cbSum)

  // ── banks: stored balance and ledger must both land on the plan figure ──
  for (const b of plan.ledgers.banks) {
    const acc = (await db.collection('bankaccounts').findOne({ _id: oid(b.id) })) as Row | null
    eq(`bank ${b.name} stored`, b.balance, num(acc?.currentBalance))
    const rows = (await db.collection('banktransactions').find({ bankAccount: oid(b.id) }).toArray()) as Row[]
    const sum = rows.reduce((a, t) => a + (t.type === 'credit' ? num(t.amount) : -num(t.amount)), 0)
    eq(`bank ${b.name} ledger`, b.balance, sum)
  }

  // ── cash lives in three places and all three must agree ────────────────
  const cashDoc = (await db.collection('cashes').findOne({})) as Row | null
  eq('cash balance', plan.ledgers.cash, num(cashDoc?.balance))
  const cashRows = (await db.collection('cashtransactions').find({}).toArray()) as Row[]
  const cashSum = cashRows.reduce((a, t) => a + (t.type === 'credit' ? num(t.amount) : -num(t.amount)), 0)
  eq('cash ledger', plan.ledgers.cash, cashSum)
  const cashAcc = (await db.collection('bankaccounts').findOne({ type: 'cash' })) as Row | null
  if (cashAcc) eq('cash account mirror', plan.ledgers.cash, num(cashAcc.currentBalance))

  // ── suppliers and investors ────────────────────────────────────────────
  for (const s of plan.ledgers.suppliers) {
    const p = (await db.collection('chinapeople').findOne({ _id: oid(s.id) })) as Row | null
    eq(`supplier ${s.name} stored`, s.balance, num(p?.currentBalance))
    const rows = (await db.collection('chinapersontransactions').find({ chinaPerson: oid(s.id) }).toArray()) as Row[]
    const sum = rows.reduce((a, t) => a + (t.type === 'pay_in' ? num(t.amount) : -num(t.amount)), 0)
    eq(`supplier ${s.name} ledger`, s.balance, sum)
  }
  for (const i of plan.ledgers.investors) {
    const inv = (await db.collection('investments').findOne({ _id: oid(i.id) })) as Row | null
    eq(`investor ${i.name} stored`, i.balance, num(inv?.currentBalance))
    const rows = (await db.collection('investmenttransactions').find({ investment: oid(i.id) }).toArray()) as Row[]
    const sum = rows.reduce((a, t) => a + (t.type === 'add' ? num(t.amount) : -num(t.amount)), 0)
    eq(`investor ${i.name} ledger`, i.balance, sum)
  }

  // ── companies: with no bills or receipts left, outstanding IS the opening ──
  for (const c of plan.companies) {
    const co = (await db.collection('companies').findOne({ _id: oid(c.id) })) as Row | null
    eq(`company ${c.name}`, c.newOpening, num(co?.openingBalance))
  }

  // ── history is gone ────────────────────────────────────────────────────
  for (const name of Object.keys(plan.wipe)) {
    const n = await db.collection(name).countDocuments()
    checked += 1
    if (n !== 0) fail.push(`${name}: expected 0 rows, found ${n}`)
  }

  // ── stock landed where the plan said ───────────────────────────────────
  for (const d of plan.china.drop) {
    checked += 1
    if (await db.collection('buyingentries').findOne({ _id: oid(d.id) })) {
      fail.push(`china entry ${d.mark} should have been removed`)
    }
  }
  for (const t of plan.china.trim) {
    const e = (await db.collection('buyingentries').findOne({ _id: oid(t.id) })) as Row | null
    if (!e) { checked += 1; fail.push(`china entry ${t.mark} is missing`); continue }
    eq(`${t.mark} totalCtn`, t.after.totalCtn, num(e.totalCtn), CTN_TOL)
    eq(`${t.mark} availableCtn`, t.after.available, num(e.availableCtn), CTN_TOL)
    eq(`${t.mark} finalCost`, t.after.finalCost, num(e.finalCost), 0.00001)
    eq(`${t.mark} givenAmount`, t.after.given, num(e.givenAmount))
    eq(`${t.mark} lockedAmount`, t.after.lockedAmount, num(e.lockedAmount))
    checked += 1
    if (num(e.soldCtn) > CTN_TOL) fail.push(`${t.mark}: soldCtn should be 0, found ${e.soldCtn}`)
  }
  for (const d of plan.india.drop) {
    checked += 1
    if (await db.collection('indiabuyingentries').findOne({ _id: oid(d.id) })) {
      fail.push(`india entry ${d.mark} should have been removed`)
    }
  }

  // ── the trap that started all this: givenAmount must survive an edit ────
  const survivors = (await db.collection('buyingentries').find({}).toArray()) as Row[]
  for (const e of survivors) {
    const adv = e.hasAdvancePayment ? num(e.advanceAmount) : 0
    const rebuilt = r2(num(e.openingGivenAmount) + adv)
    if (Math.abs(rebuilt - num(e.givenAmount)) > TOL) {
      fail.push(`${String(e.mark)}: an edit would change givenAmount from ${num(e.givenAmount)} to ${rebuilt}`)
    }
  }
  checked += survivors.length

  // ── nothing points at anything that is gone ────────────────────────────
  const entryIds = new Set(survivors.map((e) => String(e._id)))
  const containers = (await db.collection('containers').find({}).toArray()) as Row[]
  for (const c of containers) {
    for (const row of (c.entries as Row[] | undefined) ?? []) {
      checked += 1
      if (!entryIds.has(String(row.buyingEntry))) {
        fail.push(`container ${String(c.containerId)} still references a removed entry`)
      }
    }
  }

  // ── bill numbering ─────────────────────────────────────────────────────
  const counter = (await db.collection('counters').findOne({ _id: 'sellBillNumber' as never })) as Row | null
  eq('bill counter', plan.counter.to, num(counter?.seq), 0)

  return { passed: fail.length === 0, checked, failures: fail.slice(0, 40) }
}
