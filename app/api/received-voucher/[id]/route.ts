import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import PaymentReceipt from '@/models/PaymentReceipt'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import { recalcIndiaBuyingEntryGivenAndStatus } from '@/lib/india-buying-entry-payments'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid voucher id' },
        { status: 400 }
      )
    }
    await connectDB()
    const payment = await PaymentReceipt.findById(id).populate('company', 'companyName').populate('bankAccount', 'accountName').lean()
    if (!payment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Voucher not found' },
        { status: 404 }
      )
    }
    const company = payment.company as unknown as { _id: mongoose.Types.ObjectId; companyName: string } | null
    const bankAccount = payment.bankAccount as unknown as { _id: mongoose.Types.ObjectId; accountName: string } | null
    return NextResponse.json({
      success: true,
      data: {
        _id: payment._id,
        companyId: company?._id ?? payment.company,
        companyName: company?.companyName ?? '',
        amount: payment.amount,
        paymentMode: payment.paymentMode,
        bankAccountId: bankAccount?._id ?? payment.bankAccount,
        bankAccountName: bankAccount?.accountName,
        paymentDate: payment.paymentDate,
        remark: payment.remark,
        companyNote: payment.companyNote,
      },
    })
  } catch (error) {
    console.error('Received voucher get API Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

async function recomputeBankAccountBalance(bankAccountId: mongoose.Types.ObjectId): Promise<void> {
  const txs = await BankTransaction.find({ bankAccount: bankAccountId })
    .sort({ transactionDate: 1, createdAt: 1 })
    .lean()

  let balance = 0
  for (const tx of txs) {
    balance += tx.type === 'credit' ? tx.amount : -tx.amount
    await BankTransaction.updateOne({ _id: tx._id }, { $set: { balanceAfter: balance } })
  }

  await BankAccount.findByIdAndUpdate(bankAccountId, { currentBalance: balance })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid voucher id' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const companyId = body.companyId?.trim()
    const amount = Number(body.amount)
    const paymentMode = body.paymentMode as 'cash' | 'online' | undefined
    const bankAccountId = body.bankAccountId?.trim()
    const paymentDateRaw = body.paymentDate
    const remark = body.remark != null && String(body.remark).trim() ? String(body.remark).trim() : undefined
    const companyNote = body.companyNote != null && String(body.companyNote).trim() ? String(body.companyNote).trim() : undefined

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid company is required' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Amount must be a positive number' },
        { status: 400 }
      )
    }
    if (paymentMode !== 'cash' && paymentMode !== 'online') {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Payment mode must be cash or online' },
        { status: 400 }
      )
    }
    if (paymentMode === 'online') {
      if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: 'Valid bank account is required for online payments' },
          { status: 400 }
        )
      }
    }

    const paymentDate = paymentDateRaw ? new Date(paymentDateRaw) : new Date()
    if (Number.isNaN(paymentDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid payment date' },
        { status: 400 }
      )
    }

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    const payment = await PaymentReceipt.findById(id)
    if (!payment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Voucher not found' },
        { status: 404 }
      )
    }

    const company = await Company.findById(companyId).lean()
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

    const originalWasCash = (payment as { paymentMode?: string }).paymentMode === 'cash'
    const originalTx = await BankTransaction.findOne({ source: 'payment_receipt', sourceRef: payment._id })
      .sort({ transactionDate: -1, createdAt: -1 })
      .lean()

    if (originalWasCash) {
      await createCashTransaction({
        type: 'debit',
        amount: (payment as { amount: number }).amount,
        description: `Reversal of payment from ${(company as { companyName?: string }).companyName}`,
        date: new Date(),
        category: 'reversal',
        referenceId: payment._id as mongoose.Types.ObjectId,
        referenceType: 'PaymentReceipt',
        isReversal: true,
        sortOrder: 1,
      })
    } else if (originalTx) {
      const originalDate = (originalTx as { transactionDate?: Date }).transactionDate
      await BankTransaction.create({
        bankAccount: originalTx.bankAccount,
        type: 'debit',
        amount: originalTx.amount,
        balanceAfter: 0,
        source: 'payment_receipt',
        sourceRef: payment._id,
        sourceLabel: `Reversal of payment from ${(company as { companyName?: string }).companyName}`,
        transactionDate: originalDate ? new Date(originalDate) : new Date(),
        notes: originalTx.notes ?? remark,
        createdBy: updatedBy,
        sortOrder: 1,
      })
      await recomputeBankAccountBalance(originalTx.bankAccount as mongoose.Types.ObjectId)
    }

    // Resolve new bank account for updated payment
    let bankAccount: { _id: mongoose.Types.ObjectId; accountName: string } | null = null
    if (paymentMode === 'cash') {
      const cash = await BankAccount.findOne({ type: 'cash', isDefault: true }).lean()
      if (!cash) {
        return NextResponse.json(
          { success: false, error: 'Configuration', message: 'Cash bank account not found' },
          { status: 500 }
        )
      }
      bankAccount = { _id: cash._id as mongoose.Types.ObjectId, accountName: cash.accountName }
    } else if (paymentMode === 'online') {
      const account = await BankAccount.findOne({ _id: bankAccountId, type: 'online' }).lean()
      if (!account) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: 'Selected bank account not found' },
          { status: 400 }
        )
      }
      bankAccount = { _id: account._id as mongoose.Types.ObjectId, accountName: account.accountName }
    }

    if (!bankAccount) {
      return NextResponse.json(
        { success: false, error: 'Configuration', message: 'Bank account could not be resolved' },
        { status: 500 }
      )
    }

    payment.company = new mongoose.Types.ObjectId(companyId)
    payment.amount = amount
    payment.paymentMode = paymentMode
    payment.bankAccount = paymentMode === 'online' ? bankAccount._id : undefined
    payment.paymentDate = paymentDate
    payment.remark = remark
    payment.companyNote = companyNote
    payment.updatedBy = updatedBy
    await payment.save()

    if (paymentMode === 'cash') {
      await createCashTransaction({
        type: 'credit',
        amount,
        description: `Payment received from ${(company as { companyName?: string }).companyName}`,
        date: paymentDate,
        category: 'payment_received',
        referenceId: payment._id as mongoose.Types.ObjectId,
        referenceType: 'PaymentReceipt',
      })
    } else {
      const lastTx = await BankTransaction.findOne({ bankAccount: bankAccount!._id })
        .sort({ transactionDate: -1, createdAt: -1 })
        .select('balanceAfter')
        .lean()
      const lastBalance = lastTx?.balanceAfter ?? 0
      const newBalance = lastBalance + amount
      await BankTransaction.create({
        bankAccount: bankAccount!._id,
        type: 'credit',
        amount,
        balanceAfter: newBalance,
        source: 'payment_receipt',
        sourceRef: payment._id,
        sourceLabel: `Payment received from ${(company as { companyName?: string }).companyName}`,
        transactionDate: paymentDate,
        notes: remark,
        createdBy: updatedBy,
      })
      await recomputeBankAccountBalance(bankAccount!._id)
    }

    return NextResponse.json({ success: true, data: { _id: payment._id } })
  } catch (error) {
    console.error('Received voucher update API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid voucher id' },
        { status: 400 }
      )
    }

    await connectDB()
    const payment = await PaymentReceipt.findById(id).lean()
    if (!payment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Voucher not found' },
        { status: 404 }
      )
    }

    const paymentMode = (payment as { paymentMode?: string }).paymentMode

    if (paymentMode === 'set_off') {
      // Find the linked IndiaBuyingPayment and delete it, then recalculate the entry
      const linkedPayment = await IndiaBuyingPayment.findOne({ linkedPaymentReceiptId: payment._id }).lean()
      if (linkedPayment) {
        const buyingEntryId = linkedPayment.buyingEntry as mongoose.Types.ObjectId
        await IndiaBuyingPayment.findByIdAndDelete(linkedPayment._id)
        await recalcIndiaBuyingEntryGivenAndStatus(buyingEntryId)
      }
    } else if (paymentMode === 'cash') {
      await createCashTransaction({
        type: 'debit',
        amount: (payment as { amount: number }).amount,
        description: 'Reversal of deleted payment',
        date: new Date(),
        category: 'reversal',
        referenceId: payment._id as mongoose.Types.ObjectId,
        referenceType: 'PaymentReceipt',
        isReversal: true,
        sortOrder: 1,
      })
    } else {
      const tx = await BankTransaction.findOne({ source: 'payment_receipt', sourceRef: payment._id })
        .sort({ transactionDate: -1, createdAt: -1 })
        .lean()
      if (tx) {
        const originalDate = (tx as { transactionDate?: Date }).transactionDate
        await BankTransaction.create({
          bankAccount: tx.bankAccount,
          type: 'debit',
          amount: tx.amount,
          balanceAfter: 0,
          source: 'payment_receipt',
          sourceRef: payment._id,
          sourceLabel: 'Reversal of deleted payment',
          transactionDate: originalDate ? new Date(originalDate) : new Date(),
          notes: tx.notes,
          createdBy: tx.createdBy,
          sortOrder: 1,
        })
        await recomputeBankAccountBalance(tx.bankAccount as mongoose.Types.ObjectId)
      }
    }

    await PaymentReceipt.findByIdAndDelete(id)

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Received voucher delete API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
