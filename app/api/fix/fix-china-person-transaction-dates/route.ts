import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'

export const dynamic = 'force-dynamic'

/**
 * Fix ChinaPersonTransaction: string transactionDate → Date, missing transactionDate → createdAt, missing sortOrder → 0 or 1 (reversal).
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

    const all = await ChinaPersonTransaction.find({}).lean()
    let updated = 0
    for (const tx of all) {
      const updates: Record<string, unknown> = {}
      const d = (tx as { transactionDate?: unknown }).transactionDate
      if (typeof d === 'string') {
        updates.transactionDate = new Date(d)
      }
      if (d === undefined || d === null) {
        updates.transactionDate = (tx as { createdAt?: Date }).createdAt ?? new Date()
      }
      const sortOrder = (tx as { sortOrder?: number }).sortOrder
      const isReversal = (tx as { isReversal?: boolean }).isReversal === true
      if (sortOrder === undefined || sortOrder === null) {
        updates.sortOrder = isReversal ? 1 : 0
      }
      if (Object.keys(updates).length > 0) {
        await ChinaPersonTransaction.findByIdAndUpdate(tx._id, { $set: updates })
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      data: { scanned: all.length, updated, message: `Fixed ${updated} China person transaction(s).` },
    })
  } catch (error) {
    console.error('Fix China person transaction dates API Error:', error)
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
