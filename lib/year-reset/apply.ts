import { Db, ObjectId } from 'mongodb'
import type { ResetPlan } from '@/lib/year-reset/plan'

/**
 * Write the plan into a database.
 *
 * Everything here is a raw driver operation. It must never go through the app's
 * own API routes or Mongoose documents: deleting a locked buying entry through
 * the route emits a China Bank reversal, and saving one re-runs a pre-save hook
 * that can rewrite the warehouse buckets. Both would corrupt a reset mid-flight.
 *
 * Intended to run against a staging copy, never against live.
 */
export async function applyPlan(db: Db, plan: ResetPlan, ownerId: string): Promise<void> {
  // ownerId crosses as a hex string on purpose. Mongoose bundles its own mongodb
  // (and bson) at a different major version to the standalone driver used here,
  // so handing a Mongoose ObjectId to this driver throws a BSON version error.
  const owner = new ObjectId(ownerId)
  const resetAt = new Date(plan.resetAt)
  const note = `Carried forward ${plan.resetAt.slice(0, 10)}`
  const oid = (s: string) => new ObjectId(s)

  // ── 1. companies: outstanding folds into the opening balance ─────────
  if (plan.companies.length > 0) {
    await db.collection('companies').bulkWrite(
      plan.companies.map((c) => ({
        updateOne: {
          filter: { _id: oid(c.id) },
          update: { $set: { openingBalance: c.newOpening, openingBalanceNotes: note, updatedAt: resetAt } },
        },
      })),
      { ordered: false }
    )
  }

  // ── 2. China entries: drop the sold-out, trim the rest ───────────────
  if (plan.china.drop.length > 0) {
    await db.collection('buyingentries').deleteMany({ _id: { $in: plan.china.drop.map((d) => oid(d.id)) } })
  }
  if (plan.china.trim.length > 0) {
    await db.collection('buyingentries').bulkWrite(
      plan.china.trim.map((t) => ({
        updateOne: {
          filter: { _id: oid(t.id) },
          update: {
            $set: {
              totalCtn: t.after.totalCtn,
              totalQty: t.after.totalQty,
              totalCbm: t.after.totalCbm,
              totalWeight: t.after.totalWeight,
              totalAmount: t.after.totalAmount,
              rmbInrPurchase: t.after.rmbInrPurchase,
              totalCarrying: t.after.totalCarrying,
              totalExpenseINR: t.after.totalExpenseINR,
              finalCost: t.after.finalCost,
              shippingCostPerPiece: t.after.shippingCostPerPiece,
              perPisShipping: t.after.shippingCostPerPiece,
              chinaWarehouseCtn: t.after.chinaWh,
              inTransitCtn: t.after.transit,
              availableCtn: t.after.available,
              soldCtn: 0,
              givenAmount: t.after.given,
              openingGivenAmount: t.after.openingGiven,
              advanceAmount: t.after.advance,
              remainingAmount: t.after.remaining,
              currentStatus: t.after.status,
              lockedCtn: t.after.lockedCtn,
              lockedAmount: t.after.lockedAmount,
              isLocked: t.after.isLocked,
              updatedAt: resetAt,
            },
          },
        },
      })),
      { ordered: false }
    )
  }
  // Untouched entries still need the opening figure, or clearing the payment
  // rows collapses givenAmount the next time one is edited.
  if (plan.china.carry.length > 0) {
    await db.collection('buyingentries').bulkWrite(
      plan.china.carry.map((c) => ({
        updateOne: {
          filter: { _id: oid(c.id) },
          update: { $set: { openingGivenAmount: c.openingGiven, soldCtn: 0, updatedAt: resetAt } },
        },
      })),
      { ordered: false }
    )
  }

  // ── 3. India entries ─────────────────────────────────────────────────
  if (plan.india.drop.length > 0) {
    await db.collection('indiabuyingentries').deleteMany({ _id: { $in: plan.india.drop.map((d) => oid(d.id)) } })
  }
  if (plan.india.carry.length > 0) {
    await db.collection('indiabuyingentries').bulkWrite(
      plan.india.carry.map((c) => ({
        updateOne: {
          filter: { _id: oid(c.id) },
          update: { $set: { openingGivenAmount: c.openingGiven, updatedAt: resetAt } },
        },
      })),
      { ordered: false }
    )
  }

  // ── 4. history deleted outright ──────────────────────────────────────
  for (const name of Object.keys(plan.wipe)) {
    await db.collection(name).deleteMany({})
  }

  // ── 5. containers and liabilities ────────────────────────────────────
  // Containers that already delivered are finished business. Ones still holding
  // cartons must survive — they are the only way that stock reaches the warehouse.
  await db.collection('containers').deleteMany({ reachedIndiaWarehouse: true })
  const liveEntryIds = (await db.collection('buyingentries').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id)
  await db.collection('containers').updateMany(
    {},
    { $pull: { entries: { buyingEntry: { $nin: liveEntryIds } } } } as never
  )
  // Blocked liabilities stay: that money is already out of the carried cash
  // balance, so keeping them does not double-count. Released ones are history.
  await db.collection('liabilities').deleteMany({ status: 'unblocked' })

  // ── 6. ledgers: empty, then one opening row each ─────────────────────
  const base = { isOpening: true, sortOrder: 0, createdBy: owner, createdAt: resetAt, updatedAt: resetAt }

  await db.collection('chinabanktransactions').deleteMany({})
  await db.collection('chinabanktransactions').insertOne({
    ...base,
    type: plan.ledgers.chinaBank >= 0 ? 'credit' : 'debit',
    amount: Math.abs(plan.ledgers.chinaBank),
    balanceAfter: plan.ledgers.chinaBank,
    reference: `Opening balance — ${note}`,
    transactionDate: resetAt,
  })

  await db.collection('banktransactions').deleteMany({})
  if (plan.ledgers.banks.length > 0) {
    await db.collection('banktransactions').insertMany(
      plan.ledgers.banks.map((b) => ({
        ...base,
        bankAccount: oid(b.id),
        type: b.balance >= 0 ? 'credit' : 'debit',
        amount: Math.abs(b.balance),
        balanceAfter: b.balance,
        source: 'manual_add',
        sourceLabel: `Opening balance — ${note}`,
        transactionDate: resetAt,
      }))
    )
  }

  // Cash keeps its own ledger; its BankAccount row is only a mirror.
  await db.collection('cashtransactions').deleteMany({})
  await db.collection('cashtransactions').insertOne({
    isOpening: true,
    sortOrder: 0,
    createdAt: resetAt,
    updatedAt: resetAt,
    type: plan.ledgers.cash >= 0 ? 'credit' : 'debit',
    amount: Math.abs(plan.ledgers.cash),
    description: `Opening balance — ${note}`,
    date: resetAt,
    category: 'cash_in',
  })

  await db.collection('chinapersontransactions').deleteMany({})
  if (plan.ledgers.suppliers.length > 0) {
    await db.collection('chinapersontransactions').insertMany(
      plan.ledgers.suppliers.map((s) => ({
        ...base,
        chinaPerson: oid(s.id),
        type: s.balance >= 0 ? 'pay_in' : 'pay_out',
        amount: Math.abs(s.balance),
        balanceAfter: s.balance,
        transactionDate: resetAt,
        sourceLabel: `Opening balance — ${note}`,
      }))
    )
    // Rounds off float residue such as ¥50876.00040000008.
    await db.collection('chinapeople').bulkWrite(
      plan.ledgers.suppliers.map((s) => ({
        updateOne: { filter: { _id: oid(s.id) }, update: { $set: { currentBalance: s.balance } } },
      })),
      { ordered: false }
    )
  }

  await db.collection('investmenttransactions').deleteMany({})
  if (plan.ledgers.investors.length > 0) {
    await db.collection('investmenttransactions').insertMany(
      plan.ledgers.investors.map((i) => ({
        ...base,
        investment: oid(i.id),
        type: 'add',
        amount: Math.abs(i.balance),
        balanceAfter: i.balance,
        transactionDate: resetAt,
        note: `Opening balance — ${note}`,
      }))
    )
  }

  // ── 7. bill numbering ────────────────────────────────────────────────
  await db.collection('counters').updateOne(
    { _id: 'sellBillNumber' as never },
    { $set: { seq: plan.counter.to } },
    { upsert: true }
  )
}
