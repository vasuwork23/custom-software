import mongoose from 'mongoose'
import PaymentReceipt from '@/models/PaymentReceipt'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export interface CreatePaymentReceiptInput {
  companyId: string
  amount: number
  paymentMode: 'cash' | 'online'
  bankAccountId?: string
  paymentDate?: string
  remark?: string
  companyNote?: string
}

/** Carries the HTTP shape the existing route returned, so behaviour is unchanged. */
export class ReceiptError extends Error {
  status: number
  label: string
  constructor(message: string, status = 400, label = 'Validation failed') {
    super(message)
    this.name = 'ReceiptError'
    this.status = status
    this.label = label
  }
}

/** Returns an error message, or null when the payload is valid. */
export function validatePaymentReceiptInput(input: CreatePaymentReceiptInput): string | null {
  const { companyId, amount, paymentMode, bankAccountId } = input

  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    return 'Valid company is required'
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return 'Amount must be a non-zero number'
  }
  if (paymentMode !== 'cash' && paymentMode !== 'online') {
    return 'Payment mode must be cash or online'
  }
  if (paymentMode === 'online' && (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId))) {
    return 'Valid bank account is required for online payments'
  }
  if (input.paymentDate && Number.isNaN(new Date(input.paymentDate).getTime())) {
    return 'Invalid payment date'
  }
  return null
}

/**
 * Creates a payment receipt and its matching cash or bank transaction.
 * Throws ReceiptError for the cases the route surfaces with a specific status.
 * Callers creating receipts in bulk should catch per receipt and must run them
 * sequentially — the online path derives the new balance from the last one.
 */
export async function createPaymentReceipt(
  input: CreatePaymentReceiptInput,
  createdBy: mongoose.Types.ObjectId
) {
  const { companyId, amount, paymentMode } = input
  const bankAccountId = input.bankAccountId?.trim()
  const remark = input.remark != null && String(input.remark).trim() ? String(input.remark).trim() : undefined
  const companyNote =
    input.companyNote != null && String(input.companyNote).trim() ? String(input.companyNote).trim() : undefined

  const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date()
  if (Number.isNaN(paymentDate.getTime())) {
    throw new ReceiptError('Invalid payment date')
  }

  const company = await Company.findById(companyId).lean()
  if (!company) throw new ReceiptError('Company not found', 404, 'Not found')

  let bankAccount: { _id: mongoose.Types.ObjectId; accountName: string } | null = null
  if (paymentMode === 'cash') {
    const cash = await BankAccount.findOne({ type: 'cash', isDefault: true }).lean()
    if (!cash) throw new ReceiptError('Cash bank account not found', 500, 'Configuration')
    bankAccount = { _id: cash._id as mongoose.Types.ObjectId, accountName: cash.accountName }
  } else {
    const account = await BankAccount.findOne({ _id: bankAccountId, type: 'online' }).lean()
    if (!account) throw new ReceiptError('Selected bank account not found', 400)
    bankAccount = { _id: account._id as mongoose.Types.ObjectId, accountName: account.accountName }
  }

  const payment = await PaymentReceipt.create({
    company: new mongoose.Types.ObjectId(companyId),
    amount,
    paymentMode,
    bankAccount: paymentMode === 'online' ? bankAccount._id : undefined,
    paymentDate,
    remark,
    companyNote,
    createdBy,
    updatedBy: createdBy,
  })

  const txType = amount > 0 ? 'credit' : 'debit'
  const absAmount = Math.abs(amount)
  const companyName = (company as { companyName?: string }).companyName
  const txDescription =
    amount > 0 ? `Payment received from ${companyName}` : `Payment made to ${companyName}`

  if (paymentMode === 'cash') {
    const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
    await createCashTransaction({
      type: txType,
      amount: absAmount,
      description: txDescription,
      date: paymentDate,
      category: 'payment_received',
      referenceId: payment._id as mongoose.Types.ObjectId,
      referenceType: 'PaymentReceipt',
    })
  } else {
    const lastTx = await BankTransaction.findOne({ bankAccount: bankAccount._id })
      .sort({ transactionDate: -1, createdAt: -1 })
      .select('balanceAfter')
      .lean()
    const lastBalance = lastTx?.balanceAfter ?? 0
    const newBalance = lastBalance + amount
    await BankTransaction.create({
      bankAccount: bankAccount._id,
      type: txType,
      amount: absAmount,
      balanceAfter: newBalance,
      source: 'payment_receipt',
      sourceRef: payment._id,
      sourceLabel: txDescription,
      transactionDate: paymentDate,
      notes: remark,
      createdBy,
    })
    await BankAccount.findByIdAndUpdate(bankAccount._id, { currentBalance: newBalance })
  }

  return {
    receiptId: payment._id as mongoose.Types.ObjectId,
    amount,
    companyName: companyName ?? '—',
  }
}
