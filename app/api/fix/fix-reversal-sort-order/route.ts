import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankTransaction from '@/models/BankTransaction'
import CashTransaction from '@/models/CashTransaction'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * Fix existing reversal transactions: set transactionDate/date to the original's date
 * and sortOrder: 1 so that sort { date: 1, sortOrder: 1, createdAt: 1 } shows original before reversal.
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

    let chinaFixed = 0
    const chinaReversals = await ChinaPersonTransaction.find({ isReversal: true }).lean()
    for (const rev of chinaReversals) {
      let original: { transactionDate?: Date } | null = null
      const reversalOf = (rev as { reversalOf?: mongoose.Types.ObjectId }).reversalOf
      if (reversalOf) {
        original = await ChinaPersonTransaction.findById(reversalOf).select('transactionDate').lean()
      }
      const originalDate = original?.transactionDate ?? (rev as { transactionDate?: Date }).transactionDate
      await ChinaPersonTransaction.findByIdAndUpdate(rev._id, {
        $set: {
          transactionDate: originalDate ? new Date(originalDate) : (rev as { transactionDate?: Date }).transactionDate,
          sortOrder: 1,
        },
      })
      chinaFixed++
    }

    let cashFixed = 0
    const cashReversals = await CashTransaction.find({ isReversal: true }).lean()
    for (const rev of cashReversals) {
      let originalDate: Date | undefined
      const reversalOf = (rev as { reversalOf?: mongoose.Types.ObjectId }).reversalOf
      const referenceId = (rev as { referenceId?: mongoose.Types.ObjectId }).referenceId
      if (reversalOf) {
        const original = await CashTransaction.findById(reversalOf).select('date').lean()
        originalDate = original ? (original as { date?: Date }).date : undefined
      } else if (referenceId) {
        const original = await CashTransaction.findOne({
          referenceId,
          isReversal: { $ne: true },
        })
          .sort({ createdAt: 1 })
          .select('date')
          .lean()
        originalDate = original ? (original as { date?: Date }).date : undefined
      }
      const updates: Record<string, unknown> = { sortOrder: 1 }
      if (originalDate) updates.date = new Date(originalDate)
      await CashTransaction.findByIdAndUpdate(rev._id, { $set: updates })
      cashFixed++
    }

    let chinaBankFixed = 0
    const chinaBankReversals = await ChinaBankTransaction.find({ type: 'reversal' }).lean()
    for (const rev of chinaBankReversals) {
      const buyingEntry = (rev as { buyingEntry?: mongoose.Types.ObjectId }).buyingEntry
      let originalDate: Date | undefined
      if (buyingEntry) {
        const original = await ChinaBankTransaction.findOne({
          buyingEntry,
          type: 'debit',
        })
          .sort({ createdAt: 1 })
          .select('transactionDate')
          .lean()
        originalDate = original ? (original as { transactionDate?: Date }).transactionDate : undefined
      }
      const updates: Record<string, unknown> = { sortOrder: 1 }
      if (originalDate) updates.transactionDate = new Date(originalDate)
      await ChinaBankTransaction.findByIdAndUpdate(rev._id, { $set: updates })
      chinaBankFixed++
    }

    let bankFixed = 0
    const bankReversals = await BankTransaction.find({
      $or: [
        { sourceLabel: /Reversal/i },
        { sourceLabel: /Cashbook bill deleted/i },
        { notes: /Reversal/i },
      ],
    }).lean()
    for (const rev of bankReversals) {
      const sourceRef = (rev as { sourceRef?: mongoose.Types.ObjectId }).sourceRef
      let originalDate: Date | undefined
      if (sourceRef) {
        const original = await BankTransaction.findOne({
          sourceRef,
          _id: { $ne: rev._id },
        })
          .sort({ createdAt: 1 })
          .select('transactionDate')
          .lean()
        originalDate = original ? (original as { transactionDate?: Date }).transactionDate : undefined
      }
      const updates: Record<string, unknown> = { sortOrder: 1 }
      if (originalDate) updates.transactionDate = new Date(originalDate)
      await BankTransaction.findByIdAndUpdate(rev._id, { $set: updates })
      bankFixed++
    }

    return NextResponse.json({
      success: true,
      data: {
        chinaPersonFixed: chinaFixed,
        cashFixed,
        chinaBankFixed,
        bankFixed,
        message: `Fixed reversals: China Person ${chinaFixed}, Cash ${cashFixed}, China Bank ${chinaBankFixed}, Bank ${bankFixed}.`,
      },
    })
  } catch (error) {
    console.error('Fix reversal sort order API Error:', error)
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
