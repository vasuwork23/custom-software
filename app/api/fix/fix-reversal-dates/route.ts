import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import SellBill from '@/models/SellBill'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * Fix existing reversal transactions: set sortOrder: 1 and, where possible,
 * set transactionDate to the original bill/transaction date so they sort
 * correctly and appear in date range filters.
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
        { success: false, error: 'Forbidden', message: 'Only Owner can run this fix' },
        { status: 403 }
      )
    }

    await connectDB()

    const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true }).lean()
    if (!cashAccount) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Cash account not found' },
        { status: 404 }
      )
    }

    // All debits that look like reversals (cashbook or payment reversal)
    const reversals = await BankTransaction.find({
      bankAccount: cashAccount._id,
      type: 'debit',
      $or: [
        { sourceLabel: /Reversal/i },
        { sourceLabel: /Cashbook bill deleted/i },
        { notes: /Cashbook bill deleted/i },
      ],
    }).lean()

    let updatedDates = 0
    let updatedSortOrder = 0

    for (const tx of reversals) {
      const updates: { sortOrder?: number; transactionDate?: Date } = {}
      const ref = (tx as { sourceRef?: mongoose.Types.ObjectId }).sourceRef

      if (ref) {
        const bill = await SellBill.findById(ref).select('billDate').lean()
        if (bill?.billDate) {
          updates.transactionDate = new Date((bill as { billDate: Date }).billDate)
          updatedDates++
        }
      }

      if ((tx as { sortOrder?: number }).sortOrder !== 1) {
        updates.sortOrder = 1
        updatedSortOrder++
      }

      if (Object.keys(updates).length > 0) {
        await BankTransaction.findByIdAndUpdate(tx._id, { $set: updates })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        scanned: reversals.length,
        updatedSortOrder,
        updatedDates,
        message: `Processed ${reversals.length} reversal(s); set sortOrder on ${updatedSortOrder}, restored original date on ${updatedDates} (where bill still existed).`,
      },
    })
  } catch (error) {
    console.error('Fix reversal dates API Error:', error)
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
