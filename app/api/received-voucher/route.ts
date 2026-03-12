import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import PaymentReceipt from '@/models/PaymentReceipt'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

function buildDateRange(date?: string | null): { $gte: Date; $lte: Date } | undefined {
  if (!date) return undefined
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return undefined
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  return { $gte: start, $lte: end }
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
    const companyId = searchParams.get('companyId')?.trim()
    const paymentMode = searchParams.get('paymentMode')?.trim()
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()

    await connectDB()

    const filter: Record<string, unknown> = {}
    const baseFilter: Record<string, unknown> = {}

    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      filter.company = new mongoose.Types.ObjectId(companyId)
      baseFilter.company = filter.company
    }
    if (paymentMode === 'cash' || paymentMode === 'online') {
      filter.paymentMode = paymentMode
      baseFilter.paymentMode = paymentMode
    }
    if (startDate || endDate) {
      filter.paymentDate = {}
      if (startDate) (filter.paymentDate as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) (filter.paymentDate as Record<string, Date>).$lte = new Date(endDate)
    }

    const skip = (page - 1) * limit

    const [list, total, todayAgg, monthAgg] = await Promise.all([
      PaymentReceipt.find(filter)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('company', 'companyName')
        .populate('bankAccount', 'accountName')
        .lean(),
      PaymentReceipt.countDocuments(filter),
      (async () => {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
        const match: Record<string, unknown> = { ...baseFilter, paymentDate: { $gte: start, $lte: end } }
        const res = await PaymentReceipt.aggregate([
          { $match: match },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        return res[0]?.total ?? 0
      })(),
      (async () => {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        const match: Record<string, unknown> = { ...baseFilter, paymentDate: { $gte: start, $lte: end } }
        const res = await PaymentReceipt.aggregate([
          { $match: match },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        return res[0]?.total ?? 0
      })(),
    ])

    const payments = list.map((p) => ({
      _id: p._id,
      paymentDate: p.paymentDate,
      amount: p.amount,
      paymentMode: p.paymentMode,
      companyId: (p.company as { _id: mongoose.Types.ObjectId })._id,
      companyName: (p.company as { companyName: string }).companyName,
      bankAccountId: (p.bankAccount as { _id?: mongoose.Types.ObjectId } | undefined)?._id,
      bankAccountName: (p.bankAccount as { accountName?: string } | undefined)?.accountName,
      remark: p.remark,
    }))

    return NextResponse.json({
      success: true,
      data: {
        payments,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: {
          today: todayAgg,
          thisMonth: monthAgg,
        },
      },
    })
  } catch (error) {
    console.error('Received voucher list API Error:', error)
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
    const companyId = body.companyId?.trim()
    const amount = Number(body.amount)
    const paymentMode = body.paymentMode as 'cash' | 'online' | undefined
    const bankAccountId = body.bankAccountId?.trim()
    const paymentDateRaw = body.paymentDate
    const remark = body.remark != null && String(body.remark).trim() ? String(body.remark).trim() : undefined

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
    const createdBy = await resolveCreatedBy(user.id)

    const company = await Company.findById(companyId).lean()
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

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

    const payment = await PaymentReceipt.create({
      company: new mongoose.Types.ObjectId(companyId),
      amount,
      paymentMode,
      bankAccount: paymentMode === 'online' ? bankAccount._id : undefined,
      paymentDate,
      remark,
      createdBy,
      updatedBy: createdBy,
    })

    if (paymentMode === 'cash') {
      const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
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
        createdBy,
      })
      await BankAccount.findByIdAndUpdate(bankAccount!._id, { currentBalance: newBalance })
    }

    return NextResponse.json({
      success: true,
      data: {
        _id: payment._id,
      },
    })
  } catch (error) {
    console.error('Received voucher create API Error:', error)
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
