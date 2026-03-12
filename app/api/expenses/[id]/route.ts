import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import Expense from '@/models/Expense'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
        { success: false, error: 'Validation failed', message: 'Invalid expense id' },
        { status: 400 }
      )
    }
    await connectDB()
    const expense = await Expense.findById(id).populate('paidFrom', 'accountName').lean()
    if (!expense) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Expense not found' },
        { status: 404 }
      )
    }
    const paidFrom = expense.paidFrom as { _id: mongoose.Types.ObjectId; accountName: string } | null
    return NextResponse.json({
      success: true,
      data: {
        _id: expense._id,
        title: expense.title,
        amount: expense.amount,
        paidFromId: paidFrom?._id ?? expense.paidFrom,
        paidFromName: paidFrom?.accountName ?? '',
        expenseDate: expense.expenseDate,
        remark: expense.remark,
      },
    })
  } catch (error) {
    console.error('Expense get API Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
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
        { success: false, error: 'Validation failed', message: 'Invalid expense id' },
        { status: 400 }
      )
    }
    const body = await req.json()
    const title = body.title != null ? String(body.title).trim() : ''
    const amount = Number(body.amount)
    const paidFromId = body.paidFrom?.trim()
    const expenseDateRaw = body.expenseDate
    const remark = body.remark != null && String(body.remark).trim() ? String(body.remark).trim() : undefined

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Title is required' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Amount must be a positive number' },
        { status: 400 }
      )
    }
    if (!paidFromId || !mongoose.Types.ObjectId.isValid(paidFromId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid Paid From account is required' },
        { status: 400 }
      )
    }
    const expenseDate = expenseDateRaw ? new Date(expenseDateRaw) : new Date()
    if (Number.isNaN(expenseDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid expense date' },
        { status: 400 }
      )
    }

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)
    const expense = await Expense.findById(id)
    if (!expense) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Expense not found' },
        { status: 404 }
      )
    }

    const originalAccount = await BankAccount.findById(expense.paidFrom).lean()
    const originalWasCash = (originalAccount as { type?: string })?.type === 'cash'
    const originalTx = await BankTransaction.findOne({ source: 'expense', sourceRef: expense._id })
      .sort({ transactionDate: -1, createdAt: -1 })
      .lean()

    if (originalWasCash) {
      await createCashTransaction({
        type: 'credit',
        amount: expense.amount ?? 0,
        description: `Reversal: ${expense.title}`,
        date: new Date(),
        category: 'reversal',
        referenceId: expense._id as mongoose.Types.ObjectId,
        referenceType: 'Expense',
        isReversal: true,
        sortOrder: 1,
      })
    } else if (originalTx) {
      const originalDate = (originalTx as { transactionDate?: Date }).transactionDate
      await BankTransaction.create({
        bankAccount: originalTx.bankAccount,
        type: 'credit',
        amount: originalTx.amount,
        balanceAfter: 0,
        source: 'expense',
        sourceRef: expense._id,
        sourceLabel: `Reversal: ${expense.title}`,
        transactionDate: originalDate ? new Date(originalDate) : new Date(),
        notes: originalTx.notes ?? remark,
        createdBy: updatedBy,
        sortOrder: 1,
      })
      await recomputeBankAccountBalance(originalTx.bankAccount as mongoose.Types.ObjectId)
    }

    const account = await BankAccount.findById(paidFromId).lean()
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Selected account not found' },
        { status: 404 }
      )
    }
    const paidFromOid = new mongoose.Types.ObjectId(paidFromId)

    expense.title = title
    expense.amount = amount
    expense.paidFrom = paidFromOid
    expense.expenseDate = expenseDate
    expense.remark = remark
    expense.updatedBy = updatedBy
    await expense.save()

    const isCash = (account as { type?: string }).type === 'cash'
    if (isCash) {
      await createCashTransaction({
        type: 'debit',
        amount,
        description: title,
        date: expenseDate,
        category: 'expense',
        referenceId: expense._id as mongoose.Types.ObjectId,
        referenceType: 'Expense',
      })
    } else {
      const lastTx = await BankTransaction.findOne({ bankAccount: paidFromOid })
        .sort({ transactionDate: -1, createdAt: -1 })
        .select('balanceAfter')
        .lean()
      const lastBalance = lastTx?.balanceAfter ?? 0
      const newBalance = lastBalance - amount
      await BankTransaction.create({
        bankAccount: paidFromOid,
        type: 'debit',
        amount,
        balanceAfter: newBalance,
        source: 'expense',
        sourceRef: expense._id,
        sourceLabel: `Expense: ${title}`,
        transactionDate: expenseDate,
        notes: remark,
        createdBy: updatedBy,
      })
      await recomputeBankAccountBalance(paidFromOid)
    }

    return NextResponse.json({ success: true, data: { _id: expense._id } })
  } catch (error) {
    console.error('Expense update API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid expense id' },
        { status: 400 }
      )
    }
    await connectDB()
    const expense = await Expense.findById(id).lean()
    if (!expense) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Expense not found' },
        { status: 404 }
      )
    }

    const account = await BankAccount.findById((expense as { paidFrom: mongoose.Types.ObjectId }).paidFrom).lean()
    const wasCash = (account as { type?: string })?.type === 'cash'
    if (wasCash) {
      await createCashTransaction({
        type: 'credit',
        amount: (expense as { amount: number }).amount,
        description: `Reversal: ${(expense as { title: string }).title}`,
        date: new Date(),
        category: 'reversal',
        referenceId: expense._id as mongoose.Types.ObjectId,
        referenceType: 'Expense',
        isReversal: true,
        sortOrder: 1,
      })
    } else {
      const tx = await BankTransaction.findOne({ source: 'expense', sourceRef: expense._id })
        .sort({ transactionDate: -1, createdAt: -1 })
        .lean()
      if (tx) {
        const originalDate = (tx as { transactionDate?: Date }).transactionDate
        await BankTransaction.create({
          bankAccount: tx.bankAccount,
          type: 'credit',
          amount: tx.amount,
          balanceAfter: 0,
          source: 'expense',
          sourceRef: expense._id,
          sourceLabel: `Reversal: ${(expense as { title: string }).title}`,
          transactionDate: originalDate ? new Date(originalDate) : new Date(),
          notes: tx.notes,
          createdBy: tx.createdBy,
          sortOrder: 1,
        })
        await recomputeBankAccountBalance(tx.bankAccount as mongoose.Types.ObjectId)
      }
    }
    await Expense.findByIdAndDelete(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Expense delete API Error:', error)
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
