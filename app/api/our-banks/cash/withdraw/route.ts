import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Cash from '@/models/Cash'
import { createCashTransaction } from '@/lib/cash-transaction-helper'

export const dynamic = 'force-dynamic'

const withdrawCashSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  date: z.union([z.string(), z.date()]).optional(),
  note: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    const body = await req.json()
    const validated = withdrawCashSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: validated.error.errors[0]?.message ?? 'Invalid input',
        },
        { status: 400 }
      )
    }

    const { amount, date, note } = validated.data

    await connectDB()
    const cash = await Cash.findOne().lean()
    const currentBalance = cash?.balance ?? 0
    if (currentBalance < amount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Insufficient cash balance. Available: ₹${currentBalance.toLocaleString('en-IN')}`,
        },
        { status: 400 }
      )
    }

    const txDate =
      typeof date === 'string'
        ? new Date(date)
        : date instanceof Date
        ? date
        : new Date()

    await createCashTransaction({
      type: 'debit',
      amount,
      description: note?.trim() ? `Withdraw Cash — ${note.trim()}` : 'Withdraw Cash',
      date: txDate,
      category: 'other',
    })

    const updatedCash = await Cash.findOne().lean()
    return NextResponse.json({
      success: true,
      data: { balanceAfter: updatedCash?.balance ?? currentBalance - amount },
    })
  } catch (error) {
    console.error('Withdraw cash API Error:', error)
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
