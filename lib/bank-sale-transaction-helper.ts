import mongoose from 'mongoose'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export async function createBankSaleTransaction(params: {
  bankAccountId: mongoose.Types.ObjectId
  amount: number
  description: string
  date: Date | string
  referenceId: mongoose.Types.ObjectId
  createdBy: mongoose.Types.ObjectId
}): Promise<{ _id: mongoose.Types.ObjectId }> {
  const { bankAccountId, amount, description, date, referenceId, createdBy } = params

  const account = await BankAccount.findById(bankAccountId)
  if (!account) throw new Error('Bank account not found')

  // A bill discounted below zero takes money out of the account, so it posts as a debit.
  const balanceAfter = (account.currentBalance ?? 0) + amount
  account.currentBalance = balanceAfter
  await account.save()

  const tx = await BankTransaction.create({
    bankAccount: bankAccountId,
    type: amount < 0 ? 'debit' : 'credit',
    amount: Math.abs(amount),
    balanceAfter,
    source: 'bankaccount_sale',
    sourceRef: referenceId,
    sourceLabel: description,
    transactionDate: new Date(date),
    createdBy,
  })

  return { _id: tx._id as mongoose.Types.ObjectId }
}
