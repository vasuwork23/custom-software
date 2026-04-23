import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Liability from '@/models/Liability'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    await connectDB()

    const liabilities = await Liability.find({}).sort({ blockedAt: -1 }).lean()

    const totalBlocked = liabilities
      .filter((l) => l.status === 'blocked')
      .reduce((s, l) => s + (l.amount ?? 0), 0)
    const totalUnblocked = liabilities
      .filter((l) => l.status === 'unblocked')
      .reduce((s, l) => s + (l.amount ?? 0), 0)
    const activeCount = liabilities.filter(
      (l) => l.status === 'blocked'
    ).length

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalBlocked,
          totalUnblocked,
          activeCount,
        },
        liabilities,
      },
    })
  } catch (error) {
    console.error('Liabilities list API Error:', error)
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
        {
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const body = await req.json()
    const { amount, reason, source, bankAccountId } = body ?? {}

    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Valid amount is required',
        },
        { status: 400 }
      )
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Reason is required',
        },
        { status: 400 }
      )
    }

    if (!source || !['cash', 'bank'].includes(source)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Valid source is required',
        },
        { status: 400 }
      )
    }

    if (source === 'cash') {
      const { createCashTransaction } = await import('@/lib/cash-transaction-helper')

      const liability = await Liability.create({
        amount: numericAmount,
        reason: reason.trim(),
        source,
        bankAccountId: null,
        bankAccountName: 'Cash',
        status: 'blocked',
        blockedAt: new Date(),
        createdBy,
      })

      await createCashTransaction({
        type: 'debit',
        amount: numericAmount,
        description: `Liability blocked: ${reason.trim()}`,
        date: new Date(),
        category: 'other',
        referenceId: liability._id as any,
        referenceType: 'liability_block',
      })

      return NextResponse.json({
        success: true,
        data: liability,
      })
    }

    let bankAccount = null
    if (!bankAccountId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Bank account is required for bank source',
        },
        { status: 400 }
      )
    }
    bankAccount = await BankAccount.findById(bankAccountId)

    if (!bankAccount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Bank account not found',
        },
        { status: 400 }
      )
    }

    // Deduct from source balance
    const newBalance = (bankAccount.currentBalance ?? 0) - numericAmount
    bankAccount.currentBalance = newBalance
    bankAccount.updatedBy = createdBy
    await bankAccount.save()

    // Create liability record
    const liability = await Liability.create({
      amount: numericAmount,
      reason: reason.trim(),
      source,
      bankAccountId: bankAccount._id,
      bankAccountName: bankAccount.accountName,
      status: 'blocked',
      blockedAt: new Date(),
      createdBy,
    })

    // Create bank transaction (debit)
    await BankTransaction.create({
      bankAccount: bankAccount._id,
      type: 'debit',
      amount: numericAmount,
      balanceAfter: newBalance,
      source: 'manual',
      sourceRef: liability._id,
      sourceLabel: 'liability_block',
      transactionDate: new Date(),
      notes: `Liability blocked: ${reason}`,
      createdBy,
    })

    return NextResponse.json({
      success: true,
      data: liability,
    })
  } catch (error) {
    console.error('Liabilities create API Error:', error)
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

