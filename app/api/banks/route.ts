import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import CashTransaction from '@/models/CashTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** Ensure Cash entity exists (idempotent). Call after connectDB(). */
async function ensureCashAccount(createdBy: mongoose.Types.ObjectId): Promise<void> {
  const exists = await BankAccount.findOne({ type: 'cash', isDefault: true })
  if (exists) return
  await BankAccount.create({
    accountName: 'Cash',
    type: 'cash',
    isDefault: true,
    currentBalance: 0,
    createdBy,
    updatedBy: createdBy,
  })
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
    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    await ensureCashAccount(createdBy)

    const accounts = await BankAccount.find({}).sort({ isDefault: -1, accountName: 1 }).lean()
    const accountIds = accounts.map((a) => a._id)
    const counts = await BankTransaction.aggregate([
      { $match: { bankAccount: { $in: accountIds } } },
      { $group: { _id: '$bankAccount', count: { $sum: 1 } } },
    ])
    const countByAccount = Object.fromEntries(counts.map((c) => [String(c._id), c.count]))

    // Cash account uses CashTransaction ledger, not BankTransaction
    const cashTransactionCount = await CashTransaction.countDocuments()

    const list = accounts.map((a) => {
      const isCash = (a as { type?: string }).type === 'cash'
      return {
        _id: a._id,
        accountName: a.accountName,
        type: a.type,
        isDefault: a.isDefault,
        currentBalance: a.currentBalance ?? 0,
        transactionCount: isCash ? cashTransactionCount : (countByAccount[String(a._id)] ?? 0),
      }
    })

    return NextResponse.json({ success: true, data: { accounts: list } })
  } catch (error) {
    console.error('Banks list API Error:', error)
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
    const accountName = body.accountName != null ? String(body.accountName).trim() : ''
    if (!accountName) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Account name is required' },
        { status: 400 }
      )
    }
    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const account = await BankAccount.create({
      accountName,
      type: 'online',
      isDefault: false,
      currentBalance: 0,
      createdBy,
      updatedBy: createdBy,
    })
    const created = await BankAccount.findById(account._id).lean()
    return NextResponse.json({ success: true, data: { ...created, transactionCount: 0 } })
  } catch (error) {
    console.error('Bank create API Error:', error)
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
