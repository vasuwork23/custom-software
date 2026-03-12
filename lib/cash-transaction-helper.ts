import mongoose from 'mongoose'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import BankAccount from '@/models/BankAccount'
import type { CashTransactionCategory } from '@/models/CashTransaction'

export interface CreateCashTransactionParams {
  type: 'credit' | 'debit'
  amount: number
  description: string
  date: Date | string
  category: CashTransactionCategory
  referenceId?: mongoose.Types.ObjectId | null
  referenceType?: string | null
  isReversal?: boolean
  reversalOf?: mongoose.Types.ObjectId | null
  sortOrder?: number
}

/**
 * Create a cash transaction and update Cash balance.
 * Also syncs BankAccount (type cash) currentBalance so existing UI (banks list, dashboard) stays correct.
 * Use this for ALL cash movements; do not create BankTransaction for cash.
 */
export async function createCashTransaction(params: CreateCashTransactionParams): Promise<{ _id: mongoose.Types.ObjectId }> {
  const {
    type,
    amount,
    description,
    date,
    category,
    referenceId = null,
    referenceType = null,
    isReversal = false,
    reversalOf = null,
    sortOrder: sortOrderParam,
  } = params

  const delta = type === 'credit' ? amount : -amount
  const sortOrder = sortOrderParam ?? (isReversal ? 1 : 0)

  let cash = await Cash.findOne().lean()
  if (!cash) {
    await Cash.create({ balance: 0 })
    cash = await Cash.findOne().lean()
  }
  if (!cash) throw new Error('Cash document not found after create')

  const newBalance = (cash.balance ?? 0) + delta
  await Cash.findOneAndUpdate({}, { $inc: { balance: delta } })

  const tx = await CashTransaction.create({
    type,
    amount,
    description,
    date: new Date(date),
    category,
    referenceId: referenceId ?? undefined,
    referenceType: referenceType ?? undefined,
    isReversal,
    reversalOf: reversalOf ?? undefined,
    sortOrder,
  })

  const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
  if (cashAccount) {
    cashAccount.currentBalance = newBalance
    await cashAccount.save()
  }

  return { _id: tx._id as mongoose.Types.ObjectId }
}
