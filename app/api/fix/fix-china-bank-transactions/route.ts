import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import ChinaBankTransaction, { type IChinaBankTransaction } from '@/models/ChinaBankTransaction'
import CashTransaction from '@/models/CashTransaction'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

/**
 * Backfill payFrom/sourceBankAccountId for existing ChinaBankTransaction credits
 * by matching against CashTransaction/BankTransaction created around the same time.
 *
 * This is an admin-only maintenance endpoint; run once.
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

    const chinaTxs = await ChinaBankTransaction.find<IChinaBankTransaction>({
      type: 'credit',
      $or: [{ payFrom: { $exists: false } }, { payFrom: null }],
    }).lean()

    let updatedCount = 0

    for (const tx of chinaTxs) {
      const createdAt = tx.createdAt
      const windowStart = new Date(createdAt.getTime() - 5000)
      const windowEnd = new Date(createdAt.getTime() + 5000)

      // Try to match a cash transaction first
      const cashMatch = await CashTransaction.findOne({
        type: 'debit',
        amount: tx.amount,
        category: 'china_bank_payment',
        createdAt: { $gte: windowStart, $lte: windowEnd },
      }).lean()

      if (cashMatch) {
        await ChinaBankTransaction.findByIdAndUpdate(tx._id, {
          payFrom: 'cash',
          sourceBankAccountId: null,
        })
        updatedCount += 1
        continue
      }

      // Then try to match a bank transaction
      const bankMatch = await BankTransaction.findOne({
        type: 'debit',
        amount: tx.amount,
        source: 'china_bank_payment',
        createdAt: { $gte: windowStart, $lte: windowEnd },
      }).lean()

      if (bankMatch) {
        await ChinaBankTransaction.findByIdAndUpdate(tx._id, {
          payFrom: 'bank',
          sourceBankAccountId: bankMatch.bankAccount,
        })
        updatedCount += 1
      }
    }

    return NextResponse.json({
      success: true,
      data: { scanned: chinaTxs.length, updated: updatedCount },
    })
  } catch (error) {
    console.error('Fix China Bank transactions API Error:', error)
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

