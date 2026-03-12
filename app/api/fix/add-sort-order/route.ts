import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CashTransaction from '@/models/CashTransaction'

export const dynamic = 'force-dynamic'

/**
 * Add sortOrder to all CashTransaction documents that are missing it.
 * sortOrder: 0 = normal, 1 = reversal (sorts after original on same date).
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

    const normalResult = await CashTransaction.updateMany(
      { sortOrder: { $exists: false } },
      { $set: { sortOrder: 0 } }
    )

    const reversalResult = await CashTransaction.updateMany(
      { isReversal: true },
      { $set: { sortOrder: 1 } }
    )

    return NextResponse.json({
      success: true,
      data: {
        normalUpdated: normalResult.modifiedCount,
        reversalUpdated: reversalResult.modifiedCount,
        message: `Set sortOrder: 0 on ${normalResult.modifiedCount} missing, sortOrder: 1 on ${reversalResult.modifiedCount} reversal(s).`,
      },
    })
  } catch (error) {
    console.error('Add sort order API Error:', error)
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
