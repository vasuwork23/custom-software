import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CashTransaction from '@/models/CashTransaction'

export const dynamic = 'force-dynamic'

/**
 * Normalize cash reversal dates to midnight of their calendar day.
 *
 * Problem: reversal transactions were created with date = new Date() (exact timestamp)
 * while all normal cash transactions use midnight dates. This caused reversals to sort
 * at the end of their day (after all midnight transactions), so when the list is reversed
 * for display they appeared at the TOP of the day — far from their original transaction.
 *
 * Fix: set date = midnight(createdAt) for all cash reversals so they sort chronologically
 * alongside normal transactions, grouped near their original by createdAt.
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

    await connectDB()

    const reversals = await CashTransaction.find({
      $or: [{ isReversal: true }, { category: 'reversal' }],
    })
      .select('_id date createdAt')
      .lean()

    let fixed = 0
    for (const tx of reversals) {
      const base = tx.createdAt ?? tx.date
      if (!base) continue
      const midnight = new Date(base)
      midnight.setHours(0, 0, 0, 0)
      // Only update if the stored date is not already midnight
      const stored = new Date(tx.date)
      if (
        stored.getHours() !== 0 ||
        stored.getMinutes() !== 0 ||
        stored.getSeconds() !== 0 ||
        stored.getMilliseconds() !== 0
      ) {
        await CashTransaction.findByIdAndUpdate(tx._id, { date: midnight })
        fixed++
      }
    }

    return NextResponse.json({
      success: true,
      data: { total: reversals.length, fixed },
    })
  } catch (error) {
    console.error('Fix cash reversal midnight dates Error:', error)
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
