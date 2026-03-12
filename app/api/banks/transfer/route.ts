import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
    const fromAccountId = body.fromAccountId
    const toAccountId = body.toAccountId
    const amount = body.amount != null ? Number(body.amount) : NaN
    const date = body.date
    const notes = body.notes != null ? String(body.notes).trim() : undefined

    if (!fromAccountId || !mongoose.Types.ObjectId.isValid(fromAccountId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid From account is required' },
        { status: 400 }
      )
    }
    if (!toAccountId || !mongoose.Types.ObjectId.isValid(toAccountId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid To account is required' },
        { status: 400 }
      )
    }
    if (fromAccountId === toAccountId) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'From and To accounts must be different' },
        { status: 400 }
      )
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Amount must be a positive number' },
        { status: 400 }
      )
    }
    if (!date) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Date is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const fromAccount = await BankAccount.findById(fromAccountId).lean()
    const toAccount = await BankAccount.findById(toAccountId).lean()
    if (!fromAccount) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'From account not found' },
        { status: 404 }
      )
    }
    if (!toAccount) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'To account not found' },
        { status: 404 }
      )
    }

    const fromIsCash = (fromAccount as { type?: string }).type === 'cash'
    const toIsCash = (toAccount as { type?: string }).type === 'cash'

    if (fromIsCash && toIsCash) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Cannot transfer between Cash and Cash. Use cash add or cash transactions instead.',
        },
        { status: 400 }
      )
    }

    const fromId = new mongoose.Types.ObjectId(fromAccountId)
    const toId = new mongoose.Types.ObjectId(toAccountId)
    const transactionDate = new Date(date)

    const [lastFrom, lastTo] = await Promise.all([
      fromIsCash
        ? Promise.resolve<Pick<BankTransaction, 'balanceAfter'> | null>(null)
        : BankTransaction.findOne({ bankAccount: fromId })
            .sort({ createdAt: -1 })
            .select('balanceAfter')
            .lean(),
      toIsCash
        ? Promise.resolve<Pick<BankTransaction, 'balanceAfter'> | null>(null)
        : BankTransaction.findOne({ bankAccount: toId })
            .sort({ createdAt: -1 })
            .select('balanceAfter')
            .lean(),
    ])

    const lastFromBalance = lastFrom?.balanceAfter ?? 0
    const lastToBalance = lastTo?.balanceAfter ?? 0

    let newFromBalance: number | null = null
    let newToBalance: number | null = null

    let debitTx: mongoose.Document | null = null
    let creditTx: mongoose.Document | null = null

    // From side
    if (fromIsCash) {
      // Cash side: use Cash/CashTransaction ledger only; do NOT create BankTransaction for cash.
      await createCashTransaction({
        type: 'debit',
        amount,
        description: `Transfer to ${toAccount.accountName}`,
        date: transactionDate,
        category: 'bank_transfer',
      })
    } else {
      newFromBalance = lastFromBalance - amount
      debitTx = await BankTransaction.create({
        bankAccount: fromId,
        type: 'debit',
        amount,
        balanceAfter: newFromBalance,
        source: 'transfer',
        sourceLabel: `Transfer to ${toAccount.accountName}`,
        transferTo: toId,
        transactionDate,
        notes,
        createdBy,
      })
      await BankAccount.findByIdAndUpdate(fromId, {
        currentBalance: newFromBalance,
        updatedBy: createdBy,
      })
    }

    // To side
    if (toIsCash) {
      await createCashTransaction({
        type: 'credit',
        amount,
        description: `Transfer from ${fromAccount.accountName}`,
        date: transactionDate,
        category: 'bank_transfer',
      })
    } else {
      newToBalance = lastToBalance + amount
      creditTx = await BankTransaction.create({
        bankAccount: toId,
        type: 'credit',
        amount,
        balanceAfter: newToBalance,
        source: 'transfer',
        sourceLabel: `Transfer from ${fromAccount.accountName}`,
        transferTo: fromId,
        transactionDate,
        notes,
        createdBy,
      })
      await BankAccount.findByIdAndUpdate(toId, {
        currentBalance: newToBalance,
        updatedBy: createdBy,
      })
    }

    // Link bank-side transactions if both sides are bank accounts.
    if (debitTx && creditTx) {
      await BankTransaction.findByIdAndUpdate(debitTx._id, { sourceRef: creditTx._id })
      await BankTransaction.findByIdAndUpdate(creditTx._id, { sourceRef: debitTx._id })
    }

    return NextResponse.json({
      success: true,
      data: {
        debitTransactionId: debitTx?._id ?? null,
        creditTransactionId: creditTx?._id ?? null,
        fromBalance: newFromBalance,
        toBalance: newToBalance,
      },
    })
  } catch (error) {
    console.error('Bank transfer API Error:', error)
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
