import mongoose from 'mongoose'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

/**
 * Recomputes balanceAfter for every BankTransaction (createdAt ASC) and sets
 * BankAccount.currentBalance to the final running total. Use after inserts that
 * might reorder effects, or after deletes, so stored balance matches the ledger.
 */
export async function recalculateBankAccountLedger(
  accountId: mongoose.Types.ObjectId,
  options?: { session?: mongoose.ClientSession; updatedBy?: mongoose.Types.ObjectId }
): Promise<number> {
  const session = options?.session
  let txQuery = BankTransaction.find({ bankAccount: accountId }).sort({ createdAt: 1 })
  if (session) txQuery = txQuery.session(session)
  const txs = await txQuery.lean()

  let running = 0
  const bulkOps: mongoose.mongo.AnyBulkWriteOperation[] = []

  for (const t of txs) {
    const effect = t.type === 'credit' ? (t.amount as number) : -(t.amount as number)
    running += effect
    const balanceAfter = parseFloat(running.toFixed(2))
    bulkOps.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { balanceAfter } },
      },
    })
  }

  if (bulkOps.length > 0) {
    await BankTransaction.bulkWrite(bulkOps, session ? { session } : {})
  }

  const finalBalance = txs.length > 0 ? parseFloat(running.toFixed(2)) : 0

  const update: Record<string, unknown> = { currentBalance: finalBalance }
  if (options?.updatedBy) update.updatedBy = options.updatedBy

  await BankAccount.findByIdAndUpdate(accountId, update, session ? { session } : {})

  return finalBalance
}
