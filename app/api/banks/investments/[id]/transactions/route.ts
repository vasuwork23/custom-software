import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Investment from '@/models/Investment'
import InvestmentTransaction from '@/models/InvestmentTransaction'
import { createCashTransaction } from '@/lib/cash-transaction-helper'

export const dynamic = 'force-dynamic'

const txSchema = z.object({
  type: z.enum(['add', 'withdraw']),
  amount: z.number().positive('Amount must be positive'),
  date: z.union([z.string(), z.date()]).optional(),
  note: z.string().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid investor id' },
        { status: 400 }
      )
    }

    await connectDB()
    const investment = await Investment.findById(id).lean()
    if (!investment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investor not found' },
        { status: 404 }
      )
    }

    const transactions = await InvestmentTransaction.find({ investment: id })
      .sort({ transactionDate: -1, createdAt: -1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: {
        investment: {
          _id: investment._id,
          investorName: investment.investorName,
          currentBalance: investment.currentBalance ?? 0,
        },
        transactions: transactions.map((tx) => ({
          _id: tx._id,
          type: tx.type,
          amount: tx.amount,
          balanceAfter: tx.balanceAfter,
          transactionDate: tx.transactionDate,
          note: tx.note ?? '',
        })),
      },
    })
  } catch (error) {
    console.error('Investment transaction list API Error:', error)
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid investor id' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const validated = txSchema.safeParse(body)
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

    const { type, amount } = validated.data
    const note = validated.data.note?.trim() || undefined
    const transactionDate =
      typeof validated.data.date === 'string'
        ? new Date(validated.data.date)
        : validated.data.date instanceof Date
        ? validated.data.date
        : new Date()

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const investmentId = new mongoose.Types.ObjectId(id)
    const investment = await Investment.findById(investmentId).lean()
    if (!investment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investor not found' },
        { status: 404 }
      )
    }

    const oldBalance = investment.currentBalance ?? 0
    if (type === 'withdraw' && oldBalance < amount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Withdraw amount exceeds investor balance. Available: ₹${oldBalance.toLocaleString('en-IN')}`,
        },
        { status: 400 }
      )
    }

    const newBalance = type === 'add' ? oldBalance + amount : oldBalance - amount

    const updated = await Investment.findByIdAndUpdate(
      investmentId,
      { currentBalance: newBalance, updatedBy: createdBy },
      { new: true }
    ).lean()

    if (!updated?._id) {
      return NextResponse.json(
        { success: false, error: 'Internal server error', message: 'Unable to update investor balance' },
        { status: 500 }
      )
    }

    const tx = await InvestmentTransaction.create({
      investment: updated._id,
      type,
      amount,
      balanceAfter: newBalance,
      transactionDate,
      note,
      createdBy,
    })

    await createCashTransaction({
      type: type === 'add' ? 'credit' : 'debit',
      amount,
      description: `${type === 'add' ? 'Investment added' : 'Investment withdrawn'} - ${updated.investorName}`,
      date: transactionDate,
      category: 'other',
      referenceId: tx._id as mongoose.Types.ObjectId,
      referenceType: 'investment_transaction',
    })

    return NextResponse.json({
      success: true,
      data: {
        investmentId: updated._id,
        investorName: updated.investorName,
        type,
        amount,
        newBalance,
      },
    })
  } catch (error) {
    console.error('Investment transaction API Error:', error)
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
