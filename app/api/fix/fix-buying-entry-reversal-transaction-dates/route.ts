import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * One-time fix:
 * When deleting a BuyingEntry, we create reversal pay-in rows like
 * - "Advance restored (entry deleted)"
 * - "Payment restored (entry deleted)"
 *
 * Previously these reversals were saved with transactionDate = BuyingEntry.entryDate,
 * so they appeared on the original 20 Mar even if delete happened on 2 Apr.
 *
 * This fix sets transactionDate = createdAt for those reversal rows, then
 * recalculates balanceAfter and ChinaPerson.currentBalance using the updated ordering.
 *
 * NOTE: This is safe to run multiple times.
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

    const reversalNotes = ['Advance restored (entry deleted)', 'Payment restored (entry deleted)']
    const txs = await ChinaPersonTransaction.find({
      isReversal: true,
      notes: { $in: reversalNotes },
      // If transactionDate already matches createdAt for the day/time range,
      // this update is still harmless.
    })
      .select('_id chinaPerson createdAt transactionDate')
      .lean()

    if (txs.length === 0) {
      return NextResponse.json({
        success: true,
        data: { updatedTransactions: 0, personsProcessed: 0, message: 'No matching reversal transactions found' },
      })
    }

    const bulk = txs.map((tx) => ({
      updateOne: {
        filter: { _id: tx._id },
        update: { $set: { transactionDate: tx.createdAt } },
      },
    }))

    await ChinaPersonTransaction.bulkWrite(bulk)

    const personIds = Array.from(new Set(txs.map((t) => String(t.chinaPerson))))
    let personsProcessed = 0
    let transactionsRecalculated = 0

    for (const pid of personIds) {
      const personId = new mongoose.Types.ObjectId(pid)

      const transactions = await ChinaPersonTransaction.find({ chinaPerson: personId })
        .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1, _id: 1 })
        .lean()

      let running = 0
      const txUpdates = transactions.map((t) => {
        const amount = Number(t.amount ?? 0)
        if (t.type === 'pay_out') running -= amount
        else running += amount
        const balanceAfter = parseFloat(running.toFixed(2))
        transactionsRecalculated++
        return {
          updateOne: {
            filter: { _id: t._id },
            update: { $set: { balanceAfter } },
          },
        }
      })

      if (txUpdates.length > 0) {
        await ChinaPersonTransaction.bulkWrite(txUpdates)
      }

      await ChinaPerson.findByIdAndUpdate(personId, {
        $set: { currentBalance: parseFloat(running.toFixed(2)) },
      })

      personsProcessed++
    }

    return NextResponse.json({
      success: true,
      data: {
        updatedTransactions: txs.length,
        personsProcessed,
        transactionsRecalculated,
        message: 'Reversal transactionDate fixed and balances recalculated',
      },
    })
  } catch (error) {
    console.error('Fix buying entry reversal transaction dates API Error:', error)
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

