import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Cash from '@/models/Cash'
import { createCashTransaction } from '@/lib/cash-transaction-helper'

export const dynamic = 'force-dynamic'

const addCashSchema = z.object({
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
    const validated = addCashSchema.safeParse(body)

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

    const txDate =
      typeof date === 'string'
        ? new Date(date)
        : date instanceof Date
        ? date
        : new Date()

    await createCashTransaction({
      type: 'credit',
      amount,
      description: note?.trim() ? `Add Cash — ${note.trim()}` : 'Add Cash',
      date: txDate,
      category: 'cash_in',
    })

    const cash = await Cash.findOne().lean()
    const balanceAfter = cash?.balance ?? amount

    return NextResponse.json({
      success: true,
      data: { balanceAfter },
    })
  } catch (error) {
    console.error('Add cash API Error:', error)
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

