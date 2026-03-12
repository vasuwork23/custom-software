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

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()
    const paidFrom = searchParams.get('paidFrom')?.trim()

    await connectDB()

    const filter: Record<string, unknown> = {}
    const baseFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      filter.expenseDate = {}
      if (startDate) (filter.expenseDate as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) (filter.expenseDate as Record<string, Date>).$lte = new Date(endDate)
    }
    if (paidFrom && mongoose.Types.ObjectId.isValid(paidFrom)) {
      filter.paidFrom = new mongoose.Types.ObjectId(paidFrom)
      baseFilter.paidFrom = filter.paidFrom
    }

    const skip = (page - 1) * limit
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    const yearStart = new Date(now.getFullYear(), 0, 1)
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)

    const [list, total, todayAgg, monthAgg, yearAgg] = await Promise.all([
      Expense.find(filter)
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('paidFrom', 'accountName')
        .lean(),
      Expense.countDocuments(filter),
      Expense.aggregate([
        { $match: { ...baseFilter, expenseDate: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => r[0]?.total ?? 0),
      Expense.aggregate([
        { $match: { ...baseFilter, expenseDate: { $gte: monthStart, $lte: monthEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => r[0]?.total ?? 0),
      Expense.aggregate([
        { $match: { ...baseFilter, expenseDate: { $gte: yearStart, $lte: yearEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => r[0]?.total ?? 0),
    ])

    const expenses = list.map((e) => ({
      _id: e._id,
      title: e.title,
      amount: e.amount,
      expenseDate: e.expenseDate,
      remark: e.remark,
      paidFromId: (e.paidFrom as { _id: mongoose.Types.ObjectId })?._id ?? e.paidFrom,
      paidFromName: (e.paidFrom as { accountName: string })?.accountName ?? '—',
    }))

    return NextResponse.json({
      success: true,
      data: {
        expenses,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { today: todayAgg, thisMonth: monthAgg, thisYear: yearAgg },
      },
    })
  } catch (error) {
    console.error('Expenses list API Error:', error)
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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
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
    const createdBy = await resolveCreatedBy(user.id)

    const account = await BankAccount.findById(paidFromId).lean()
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Selected account not found' },
        { status: 404 }
      )
    }
    const paidFromOid = new mongoose.Types.ObjectId(paidFromId)
    const currentBalance = account.currentBalance ?? 0
    const balanceAfterDebit = currentBalance - amount
    const balanceWarning = balanceAfterDebit < 0

    const expense = await Expense.create({
      title,
      amount,
      paidFrom: paidFromOid,
      expenseDate,
      remark,
      createdBy,
      updatedBy: createdBy,
    })

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
        createdBy,
      })
      await BankAccount.findByIdAndUpdate(paidFromOid, { currentBalance: newBalance })
    }

    return NextResponse.json({
      success: true,
      data: {
        _id: expense._id,
        balanceWarning: balanceWarning || undefined,
      },
    })
  } catch (error) {
    console.error('Expense create API Error:', error)
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
