import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction, { type IBankTransaction } from '@/models/BankTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * DELETE a bank transaction. Only allowed for source === 'manual_add' (amount additions).
 * Reverses the amount on the bank account balance and removes the transaction.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; txId: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { id, txId } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid account id' },
        { status: 400 }
      )
    }
    if (!txId || !mongoose.Types.ObjectId.isValid(txId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid transaction id' },
        { status: 400 }
      )
    }

    await connectDB()
    const accountId = new mongoose.Types.ObjectId(id)
    const txObjectId = new mongoose.Types.ObjectId(txId)

    const tx = await BankTransaction.findById(txObjectId).lean<IBankTransaction>()
    if (!tx) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Transaction not found' },
        { status: 404 }
      )
    }

    if (tx.source !== 'manual_add') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message:
            'Only manually added transactions can be deleted. System transactions cannot be removed.',
        },
        { status: 403 }
      )
    }

    if (tx.bankAccount.toString() !== id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Transaction does not belong to this account',
        },
        { status: 403 }
      )
    }

    const balanceChange = tx.type === 'credit' ? -tx.amount : tx.amount
    const updatedBy = await resolveCreatedBy(user.id)
    const updated = await BankAccount.findByIdAndUpdate(
      accountId,
      { $inc: { currentBalance: balanceChange }, updatedBy },
      { new: true }
    ).lean()

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Bank account not found' },
        { status: 404 }
      )
    }

    await BankTransaction.findByIdAndDelete(txObjectId)

    return NextResponse.json({
      success: true,
      data: { newBalance: updated.currentBalance },
      message: 'Transaction deleted',
    })
  } catch (error) {
    console.error('Bank transaction delete API Error:', error)
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
