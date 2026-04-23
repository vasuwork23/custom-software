import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import CashTransaction from '@/models/CashTransaction'
import BankTransaction from '@/models/BankTransaction'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'

export const dynamic = 'force-dynamic'

/**
 * Fix transactions whose business date fields are stuck at midnight UTC
 * by replacing them with the corresponding createdAt timestamp.
 *
 * This targets:
 * - ChinaPersonTransaction.transactionDate
 * - CashTransaction.date
 * - BankTransaction.transactionDate
 * - ChinaBankTransaction.transactionDate
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

    const models: {
      key: string
      model: any
      field: 'transactionDate' | 'date'
    }[] = [
      { key: 'ChinaPersonTransaction', model: ChinaPersonTransaction, field: 'transactionDate' },
      { key: 'CashTransaction', model: CashTransaction, field: 'date' },
      { key: 'BankTransaction', model: BankTransaction, field: 'transactionDate' },
      { key: 'ChinaBankTransaction', model: ChinaBankTransaction, field: 'transactionDate' },
    ]

    const results: Record<string, number> = {}

    for (const { key, model, field } of models) {
      const all = await model.find({}).select(`_id ${field} createdAt`).lean()
      let fixed = 0

      for (const tx of all) {
        const raw = (tx as Record<string, unknown>)[field]
        const createdAt = (tx as { createdAt?: Date }).createdAt
        if (!raw || !createdAt) continue
        const d = new Date(raw as Date | string)
        if (
          d.getUTCHours() === 0 &&
          d.getUTCMinutes() === 0 &&
          d.getUTCSeconds() === 0 &&
          d.getUTCMilliseconds() === 0
        ) {
          await model.findByIdAndUpdate(tx._id, {
            [field]: createdAt,
          })
          fixed += 1
        }
      }

      results[key] = fixed
    }

    return NextResponse.json({ success: true, data: { fixed: results } })
  } catch (error) {
    console.error('Fix midnight transaction dates API Error:', error)
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

