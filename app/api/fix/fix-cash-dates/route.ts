import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CashTransaction from '@/models/CashTransaction'

export const dynamic = 'force-dynamic'

/**
 * Fix CashTransaction documents where date is stored as string instead of Date.
 * String dates sort alphabetically, not chronologically.
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

    const all = await CashTransaction.find({}).lean()
    let updated = 0
    for (const tx of all) {
      const d = (tx as { date?: unknown }).date
      if (typeof d === 'string') {
        await CashTransaction.findByIdAndUpdate(tx._id, {
          $set: { date: new Date(d) },
        })
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        scanned: all.length,
        updated,
        message: `Fixed ${updated} transaction(s) with string date.`,
      },
    })
  } catch (error) {
    console.error('Fix cash dates API Error:', error)
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
