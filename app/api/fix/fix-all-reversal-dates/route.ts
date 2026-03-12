import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import CashTransaction from '@/models/CashTransaction'
import BankTransaction from '@/models/BankTransaction'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'

export const dynamic = 'force-dynamic'

/**
 * Normalize transaction dates for ALL reversal-like transactions across modules.
 *
 * Rule: for reversals/unlocks, the effective business date should be when the
 * action happened (createdAt), not the original entry date.
 *
 * This migration:
 * - ChinaBankTransaction: transactionDate = createdAt for type: 'reversal' or isReversal: true
 * - CashTransaction:      date = createdAt for isReversal: true or category: 'reversal'
 * - BankTransaction:      transactionDate = createdAt for isReversal: true or source: 'reversal'
 * - ChinaPersonTransaction: transactionDate = createdAt for isReversal: true
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

    const chinaBankReversals = await ChinaBankTransaction.find({
      $or: [{ type: 'reversal' }, { isReversal: true }],
    })
      .select('_id createdAt transactionDate')
      .lean()

    for (const tx of chinaBankReversals) {
      if (!tx.createdAt) continue
      await ChinaBankTransaction.findByIdAndUpdate(tx._id, {
        transactionDate: tx.createdAt,
      })
    }

    const cashReversals = await CashTransaction.find({
      $or: [{ isReversal: true }, { category: 'reversal' }],
    })
      .select('_id createdAt date')
      .lean()

    for (const tx of cashReversals) {
      if (!tx.createdAt) continue
      await CashTransaction.findByIdAndUpdate(tx._id, {
        date: tx.createdAt,
      })
    }

    const bankReversals = await BankTransaction.find({
      $or: [{ isReversal: true }, { source: 'reversal' }],
    })
      .select('_id createdAt transactionDate')
      .lean()

    for (const tx of bankReversals) {
      if (!tx.createdAt) continue
      await BankTransaction.findByIdAndUpdate(tx._id, {
        transactionDate: tx.createdAt,
      })
    }

    const chinaPersonReversals = await ChinaPersonTransaction.find({
      isReversal: true,
    })
      .select('_id createdAt transactionDate')
      .lean()

    for (const tx of chinaPersonReversals) {
      if (!tx.createdAt) continue
      await ChinaPersonTransaction.findByIdAndUpdate(tx._id, {
        transactionDate: tx.createdAt,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        chinaBank: chinaBankReversals.length,
        cash: cashReversals.length,
        bank: bankReversals.length,
        chinaPerson: chinaPersonReversals.length,
        total:
          chinaBankReversals.length +
          cashReversals.length +
          bankReversals.length +
          chinaPersonReversals.length,
      },
    })
  } catch (error) {
    console.error('Fix all reversal dates API Error:', error)
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

