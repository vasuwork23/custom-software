import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * Recalculate currentBalance for each ChinaPerson from their transactions (transactionDate asc).
 * pay_out = balance decreases, pay_in = balance increases. Then update person.currentBalance.
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

    const persons = await ChinaPerson.find({}).lean()
    let fixed = 0
    for (const person of persons) {
      const personId = person._id as mongoose.Types.ObjectId
      const transactions = await ChinaPersonTransaction.find({ chinaPerson: personId })
        .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1 })
        .lean()

      let balance = 0
      for (const tx of transactions) {
        const amount = tx.amount as number
        if (tx.type === 'pay_out') balance -= amount
        else balance += amount
      }

      const stored = (person as { currentBalance?: number }).currentBalance ?? 0
      if (Math.abs(balance - stored) > 0.001) {
        await ChinaPerson.findByIdAndUpdate(personId, { $set: { currentBalance: Math.round(balance * 100) / 100 } })
        fixed++
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: persons.length,
        fixed,
        message: `Recalculated balances for ${persons.length} China person(s); updated ${fixed}.`,
      },
    })
  } catch (error) {
    console.error('Recalculate China person balances API Error:', error)
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
