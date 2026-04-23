import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'

export const dynamic = 'force-dynamic'

/**
 * Fix historical ChinaBankTransaction reversal entries whose transactionDate was set
 * to an old value (e.g. original entry date) instead of when the reversal actually occurred.
 *
 * Strategy: for all type: 'reversal' rows, set transactionDate = createdAt.
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

    const reversals = await ChinaBankTransaction.find({ type: 'reversal' })
      .select('_id createdAt transactionDate')
      .lean()

    for (const tx of reversals) {
      const correctDate = tx.createdAt
      if (!correctDate) continue
      await ChinaBankTransaction.findByIdAndUpdate(tx._id, {
        transactionDate: correctDate,
      })
    }

    return NextResponse.json({
      success: true,
      data: { fixed: reversals.length },
    })
  } catch (error) {
    console.error('Fix China Bank reversal dates API Error:', error)
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

