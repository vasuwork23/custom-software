import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Cash from '@/models/Cash'
import CashTransaction, { type ICashTransaction } from '@/models/CashTransaction'
import BankAccount from '@/models/BankAccount'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * DELETE a cash transaction.
 * Allows deleting manual cash-in and manual withdraw-cash entries.
 * Reverses the effect on both Cash.balance and the default cash BankAccount currentBalance.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ txId: string }> }
) {
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

    const { txId } = await params

    if (!txId || !mongoose.Types.ObjectId.isValid(txId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Invalid transaction id',
        },
        { status: 400 }
      )
    }

    await connectDB()

    const tx = await CashTransaction.findById(txId).lean<ICashTransaction | null>()
    if (!tx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Transaction not found',
        },
        { status: 404 }
      )
    }

    const isManualCashIn = tx.category === 'cash_in'
    const isManualWithdraw = typeof tx.description === 'string' && tx.description.startsWith('Withdraw Cash')

    // Only allow deleting manual add/withdraw cash entries.
    if (!isManualCashIn && !isManualWithdraw) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message:
            'Only manual Add Cash / Withdraw Cash transactions can be deleted. System transactions cannot be removed.',
        },
        { status: 403 }
      )
    }

    // Reverse the cash balance. For credits we subtract, for debits we add back.
    const delta = tx.type === 'credit' ? -tx.amount : tx.amount

    // Update Cash aggregate balance.
    const updatedCash = await Cash.findOneAndUpdate(
      {},
      { $inc: { balance: delta } },
      { new: true }
    ).lean()

    // Also keep the default cash BankAccount in sync if it exists.
    const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
    if (cashAccount && updatedCash) {
      cashAccount.currentBalance = updatedCash.balance
      await cashAccount.save()
    }

    await CashTransaction.findByIdAndDelete(txId)

    return NextResponse.json({
      success: true,
      message: 'Transaction deleted and cash balance reversed',
      data: {
        newBalance: updatedCash?.balance ?? null,
      },
    })
  } catch (error) {
    console.error('Delete cash transaction API Error:', error)
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

