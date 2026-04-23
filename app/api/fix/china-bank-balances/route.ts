import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'

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

    const txs = await ChinaBankTransaction.find({}).sort({ createdAt: 1 }).exec()
    let running = 0
    for (const tx of txs) {
      if (tx.type === 'credit') running += tx.amount
      else if (tx.type === 'debit') running -= tx.amount
      else if (tx.type === 'reversal') running += tx.amount
      tx.balanceAfter = running
      await tx.save()
    }

    return NextResponse.json({
      success: true,
      data: { fixed: true },
      message: 'China Bank balances recalculated successfully',
    })
  } catch (error) {
    console.error('Fix China Bank balances API Error:', error)
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

