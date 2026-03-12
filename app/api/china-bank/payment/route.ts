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

const paymentSchema = z.object({
  inrAmount: z.number().positive('INR amount must be positive'),
  payFromSource: z.string().min(1, 'Pay from source is required'),
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
    const validated = paymentSchema.safeParse(body)

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

    const { inrAmount, payFromSource, date, note } = validated.data

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    // Determine source bank account (cash or specific bank)
    let bankAccount
    if (payFromSource === 'cash') {
      bankAccount = await BankAccount.findOne({
        type: 'cash',
        isDefault: true,
      })
    } else {
      bankAccount = await BankAccount.findById(payFromSource)
    }

    if (!bankAccount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Source account not found',
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

    // Step 1: debit source ONCE (cash uses Cash ledger only; bank uses BankAccount + BankTransaction)
    const isCashSource = (bankAccount as { type?: string }).type === 'cash'
    if (isCashSource) {
      // Cash: ONLY createCashTransaction — it updates Cash.balance and syncs BankAccount (cash).currentBalance.
      // Do NOT also update bankAccount or create BankTransaction here (would double-debit).
      await createCashTransaction({
        type: 'debit',
        amount: inrAmount,
        description: `China Bank payment${note ? ' — ' + note : ''}`,
        date: txDate,
        category: 'china_bank_payment',
      })
    } else {
      // Non-cash: debit this bank account once (balance + BankTransaction)
      const newBankBalance = (bankAccount.currentBalance ?? 0) - inrAmount
      bankAccount.currentBalance = newBankBalance
      bankAccount.updatedBy = createdBy
      await bankAccount.save()

      await BankTransaction.create({
        bankAccount: bankAccount._id,
        type: 'debit',
        amount: inrAmount,
        balanceAfter: newBankBalance,
        source: 'china_bank_payment',
        sourceRef: undefined,
        sourceLabel: `China Bank payment${note ? ' — ' + note : ''}`,
        transactionDate: txDate,
        notes: note ?? undefined,
        createdBy,
      })
    }

    // Step 2: credit China Bank (balance tracked in INR)
    const lastTx = await ChinaBankTransaction.findOne()
      .sort({ createdAt: -1 })
      .select('balanceAfter')
      .lean()

    const lastBalance = lastTx?.balanceAfter ?? 0
    const chinaBalanceAfter = lastBalance + inrAmount

    const chinaTx = await ChinaBankTransaction.create<IChinaBankTransaction>({
      type: 'credit',
      amount: inrAmount,
      balanceAfter: chinaBalanceAfter,
      reference: note ?? undefined,
      notes: note ?? 'Payment received',
      transactionDate: txDate,
      sortOrder: 0,
      payFrom: isCashSource ? 'cash' : 'bank',
      sourceBankAccountId: isCashSource ? null : bankAccount._id,
      createdBy,
    })

    return NextResponse.json({
      success: true,
      data: {
        bankTransactionId: chinaTx._id,
        chinaBankBalance: chinaBalanceAfter,
      },
    })
  } catch (error) {
    console.error('China Bank payment API Error:', error)
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

