import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import CashTransaction from '@/models/CashTransaction'

export const dynamic = 'force-dynamic'

/** Fix CashTransaction.date fields that are stuck at midnight by copying time from createdAt. */
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
        { success: false, error: 'Forbidden', message: 'Only Owner can run cash date fixes' },
        { status: 403 }
      )
    }

    await connectDB()

    const all = await CashTransaction.find({}).lean()
    let fixed = 0

    for (const tx of all) {
      const date = (tx as { date?: Date }).date
      const createdAt = (tx as { createdAt?: Date }).createdAt
      if (!date || !createdAt) continue

      const d = new Date(date)
      const c = new Date(createdAt)
      if (
        d.getUTCFullYear() === c.getUTCFullYear() &&
        d.getUTCMonth() === c.getUTCMonth() &&
        d.getUTCDate() === c.getUTCDate() &&
        d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0
      ) {
        // eslint-disable-next-line no-await-in-loop
        await CashTransaction.findByIdAndUpdate(tx._id, {
          $set: { date: createdAt },
        })
        fixed += 1
      }
    }

    return NextResponse.json({
      success: true,
      data: { fixed },
      message: `Updated ${fixed} cash transactions with midnight dates`,
    })
  } catch (error) {
    console.error('Fix cash midnight dates API Error:', error)
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

