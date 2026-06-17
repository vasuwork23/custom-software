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

  const balanceAfter = (account.currentBalance ?? 0) + amount
  account.currentBalance = balanceAfter
  await account.save()

  const tx = await BankTransaction.create({
    bankAccount: bankAccountId,
    type: 'credit',
    amount,
    balanceAfter,
    source: 'bankaccount_sale',
    sourceRef: referenceId,
    sourceLabel: description,
    transactionDate: new Date(date),
    createdBy,
  })

  return { _id: tx._id as mongoose.Types.ObjectId }
}
