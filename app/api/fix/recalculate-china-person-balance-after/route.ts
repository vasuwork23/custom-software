import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * Recalculate balanceAfter for all ChinaPersonTransaction documents and
 * sync ChinaPerson.currentBalance from transactions.
 *
 * Order: transactionDate ASC, sortOrder ASC, createdAt ASC.
 * pay_out = balance decreases, pay_in/credit = balance increases.
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
    let updatedPersons = 0
    let updatedTransactions = 0

    for (const person of persons) {
      const personId = person._id as mongoose.Types.ObjectId
      const transactions = await ChinaPersonTransaction.find({ chinaPerson: personId })
        .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1 })
        .lean()

      let running = 0
      for (const tx of transactions) {
        const amount = Number(tx.amount ?? 0)
        if (tx.type === 'pay_out') running -= amount
        else running += amount

        const balanceAfter = parseFloat(running.toFixed(2))
        await ChinaPersonTransaction.findByIdAndUpdate(tx._id, {
          $set: { balanceAfter },
        })
        updatedTransactions++
      }

      const finalBalance = parseFloat(running.toFixed(2))
      await ChinaPerson.findByIdAndUpdate(personId, {
        $set: { currentBalance: finalBalance },
      })
      updatedPersons++
    }

    return NextResponse.json({
      success: true,
      data: {
        personsProcessed: persons.length,
        updatedPersons,
        updatedTransactions,
      },
    })
  } catch (error) {
    console.error('Recalculate China person balanceAfter API Error:', error)
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

