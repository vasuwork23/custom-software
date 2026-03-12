import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can run balance fixes' },
        { status: 403 }
      )
    }

    await connectDB()

    const accounts = await BankAccount.find({}).lean()
    for (const account of accounts) {
      const accountId = account._id
      const txs = await BankTransaction.find({ bankAccount: accountId })
        .sort({ createdAt: 1 })
        .exec()

      let running = 0
      for (const tx of txs) {
        if (tx.type === 'credit') running += tx.amount
        else if (tx.type === 'debit') running -= tx.amount
        tx.balanceAfter = running
        await tx.save()
      }

      await BankAccount.findByIdAndUpdate(accountId, { currentBalance: running })
    }

    return NextResponse.json({
      success: true,
      data: { fixed: true },
      message: 'Bank balances recalculated successfully',
    })
  } catch (error) {
    console.error('Fix bank balances API Error:', error)
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

