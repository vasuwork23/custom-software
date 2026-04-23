import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import ChinaBankTransaction, { type IChinaBankTransaction } from '@/models/ChinaBankTransaction'
import { createCashTransaction } from '@/lib/cash-transaction-helper'

export const dynamic = 'force-dynamic'

const withdrawalSchema = z.object({
  inrAmount: z.number().positive('INR amount must be positive'),
  sendToDestination: z.string().min(1, 'Destination is required'),
  date: z.union([z.string(), z.date()]).optional(),
  note: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const validated = withdrawalSchema.safeParse(body)

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

    const { inrAmount, sendToDestination, date, note } = validated.data

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    // Resolve destination account
    let destAccount
    if (sendToDestination === 'cash') {
      destAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
    } else {
      destAccount = await BankAccount.findById(sendToDestination)
    }

    if (!destAccount) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Destination account not found' },
        { status: 400 }
      )
    }

    const txDate =
      typeof date === 'string'
        ? new Date(date)
        : date instanceof Date
        ? date
        : new Date()

    const isCashDest = (destAccount as { type?: string }).type === 'cash'

    // Step 1: debit China Bank
    const lastTx = await ChinaBankTransaction.findOne()
      .sort({ createdAt: -1 })
      .select('balanceAfter')
      .lean<IChinaBankTransaction | null>()

    const lastBalance = lastTx?.balanceAfter ?? 0
    const chinaBalanceAfter = lastBalance - inrAmount

    const chinaTx = await ChinaBankTransaction.create({
      type: 'debit',
      amount: inrAmount,
      balanceAfter: chinaBalanceAfter,
      reference: note ?? undefined,
      notes: note ?? 'Transfer out',
      transactionDate: txDate,
      sortOrder: 0,
      payTo: isCashDest ? 'cash' : 'bank',
      destBankAccountId: isCashDest ? null : destAccount._id,
      createdBy,
    })

    // Step 2: credit destination account
    if (isCashDest) {
      await createCashTransaction({
        type: 'credit',
        amount: inrAmount,
        description: `China Bank transfer${note ? ' — ' + note : ''}`,
        date: txDate,
        category: 'china_bank_withdrawal',
      })
    } else {
      const newDestBalance = (destAccount.currentBalance ?? 0) + inrAmount
      destAccount.currentBalance = newDestBalance
      destAccount.updatedBy = createdBy
      await destAccount.save()

      await BankTransaction.create({
        bankAccount: destAccount._id,
        type: 'credit',
        amount: inrAmount,
        balanceAfter: newDestBalance,
        source: 'china_bank_withdrawal',
        sourceRef: chinaTx._id,
        sourceLabel: `China Bank transfer${note ? ' — ' + note : ''}`,
        transactionDate: txDate,
        notes: note ?? undefined,
        createdBy,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        transactionId: chinaTx._id,
        chinaBankBalance: chinaBalanceAfter,
      },
    })
  } catch (error) {
    console.error('China Bank withdrawal API Error:', error)
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
