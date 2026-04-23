import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

const addAmountSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  date: z.union([z.string(), z.date()]).optional(),
  note: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Invalid bank account id',
        },
        { status: 400 }
      )
    }

    const body = await req.json()
    const validated = addAmountSchema.safeParse(body)

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
    const createdBy = await resolveCreatedBy(user.id)

    const accountId = new mongoose.Types.ObjectId(id)
    const account = await BankAccount.findById(accountId).lean()
    if (!account) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Bank account not found',
        },
        { status: 404 }
      )
    }

    const txDate =
      typeof date === 'string'
        ? new Date(date)
        : date instanceof Date
        ? date
        : new Date()

    const lastTx = await BankTransaction.findOne({ bankAccount: accountId })
      .sort({ createdAt: -1 })
      .select('balanceAfter')
      .lean()
    const lastBalance = lastTx?.balanceAfter ?? 0
    const newBalance = lastBalance + amount

    const tx = await BankTransaction.create({
      bankAccount: accountId,
      type: 'credit',
      amount,
      balanceAfter: newBalance,
      source: 'manual_add',
      sourceLabel: note?.trim()
        ? `Amount added — ${note.trim()}`
        : 'Amount added',
      transactionDate: txDate,
      notes: note?.trim() || undefined,
      createdBy,
    })

    await BankAccount.findByIdAndUpdate(accountId, {
      currentBalance: newBalance,
      updatedBy: createdBy,
    })

    return NextResponse.json({
      success: true,
      data: {
        transactionId: tx._id,
        newBalance,
      },
    })
  } catch (error) {
    console.error('Add bank amount API Error:', error)
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

