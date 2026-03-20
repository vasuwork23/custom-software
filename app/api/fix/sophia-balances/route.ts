import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'

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

    const persons = await ChinaPerson.find({}).lean()
    for (const person of persons) {
      const personId = person._id
      // Recalculate using the same timeline order as the UI ("Date" column).
      const txs = await ChinaPersonTransaction.find({ chinaPerson: personId })
        .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1, _id: 1 })
        .exec()

      // Normalize transactionDate time if it looks like date-only (midnight UTC).
      // This fixes cases where Pay In/Payout were saved with transactionDate=YYYY-MM-DD (no time),
      // causing wrong ordering inside the same day.
      for (const tx of txs) {
        const td = tx.transactionDate
        const looksLikeDateOnly =
          td.getUTCHours() === 0 &&
          td.getUTCMinutes() === 0 &&
          td.getUTCSeconds() === 0 &&
          td.getUTCMilliseconds() === 0
        if (!looksLikeDateOnly) continue

        const ca = tx.createdAt
        tx.transactionDate = new Date(
          Date.UTC(
            td.getUTCFullYear(),
            td.getUTCMonth(),
            td.getUTCDate(),
            ca.getUTCHours(),
            ca.getUTCMinutes(),
            ca.getUTCSeconds(),
            ca.getUTCMilliseconds()
          )
        )
        await tx.save()
      }

      const anchorBalance = person.currentBalance ?? 0
      const sumDelta = txs.reduce((acc, tx) => {
        const delta = tx.type === 'pay_in' ? tx.amount : -tx.amount
        return acc + delta
      }, 0)
      let running = anchorBalance - sumDelta

      for (const tx of txs) {
        if (tx.type === 'pay_in') running += tx.amount
        else if (tx.type === 'pay_out') running -= tx.amount
        tx.balanceAfter = running
        await tx.save()
      }

      // running should end at anchorBalance, but keep it explicit.
      await ChinaPerson.findByIdAndUpdate(personId, { currentBalance: anchorBalance })
    }

    return NextResponse.json({
      success: true,
      data: { fixed: true },
      message: 'Sophia balances recalculated successfully',
    })
  } catch (error) {
    console.error('Fix Sophia balances API Error:', error)
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

