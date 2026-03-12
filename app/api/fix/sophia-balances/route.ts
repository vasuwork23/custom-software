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
      const txs = await ChinaPersonTransaction.find({ chinaPerson: personId })
        .sort({ createdAt: 1 })
        .exec()

      let running = 0
      for (const tx of txs) {
        if (tx.type === 'pay_in') running += tx.amount
        else if (tx.type === 'pay_out') running -= tx.amount
        tx.balanceAfter = running
        await tx.save()
      }

      await ChinaPerson.findByIdAndUpdate(personId, { currentBalance: running })
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

