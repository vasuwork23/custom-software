import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'

export const dynamic = 'force-dynamic'

/**
 * Rounds all CTN fields to 2 decimal places in BuyingEntry documents.
 * Run this to clean existing floating-point values (e.g. 9.200000000000003 → 9.2).
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
        { success: false, error: 'Forbidden', message: 'Only Owner can run round CTN values' },
        { status: 403 }
      )
    }

    await connectDB()

    const entries = await BuyingEntry.find({}).lean()
    let fixed = 0

    for (const entry of entries) {
      await BuyingEntry.findByIdAndUpdate(entry._id, {
        availableCtn: parseFloat((entry.availableCtn ?? 0).toFixed(2)),
        soldCtn: parseFloat((entry.soldCtn ?? 0).toFixed(2)),
        chinaWarehouseCtn: parseFloat((entry.chinaWarehouseCtn ?? 0).toFixed(2)),
        inTransitCtn: parseFloat((entry.inTransitCtn ?? 0).toFixed(2)),
      })
      fixed += 1
    }

    return NextResponse.json({
      success: true,
      data: { fixed },
      message: `Rounded CTN fields to 2 decimal places for ${fixed} buying entries.`,
    })
  } catch (error) {
    console.error('Fix round CTN values API Error:', error)
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
