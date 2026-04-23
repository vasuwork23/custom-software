import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import BankAccount from '@/models/BankAccount'

export const dynamic = 'force-dynamic'

/**
 * Recalculate correct cash balance from CashTransaction ledger and fix Cash + BankAccount (cash).
 * Use after a double-debit or wrong balance (e.g. cash → China Bank transfer bug).
 */
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
    const createdBy = await resolveCreatedBy(user.id)

    const allTx = await CashTransaction.find({}).sort({ createdAt: 1 }).lean()
    let correct = 0
    for (const tx of allTx) {
      if (tx.type === 'credit') correct += tx.amount
      else correct -= tx.amount
    }
    correct = Math.round(correct * 100) / 100

    const cashDoc = await Cash.findOne().lean()
    const previousBalance = cashDoc?.balance ?? 0

    await Cash.findOneAndUpdate({}, { $set: { balance: correct } })

    const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
    if (cashAccount) {
      cashAccount.currentBalance = correct
      cashAccount.updatedBy = createdBy
      await cashAccount.save()
    }

    return NextResponse.json({
      success: true,
      data: {
        correctedBalance: correct,
        previousBalance,
        transactionCount: allTx.length,
      },
      message: `Cash balance corrected from ₹${previousBalance.toLocaleString('en-IN')} to ₹${correct.toLocaleString('en-IN')}`,
    })
  } catch (error) {
    console.error('Fix cash balance API Error:', error)
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
