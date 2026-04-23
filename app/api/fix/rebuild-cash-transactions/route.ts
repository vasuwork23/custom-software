import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import type { CashTransactionCategory } from '@/models/CashTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

function mapSourceToCategory(source: string): CashTransactionCategory {
  switch (source) {
    case 'payment_receipt':
      return 'payment_received'
    case 'expense':
      return 'expense'
    case 'manual':
      return 'cash_in'
    case 'cashbook_sale':
      return 'cashbook_sale'
    case 'transfer':
      return 'bank_transfer'
    default:
      return 'other'
  }
}

/**
 * Rebuild CashTransaction ledger from existing BankTransaction (cash account) data.
 * Run once after switching to Cash + CashTransaction. Preserves all history and correct balance.
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
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can run this fix' },
        { status: 403 }
      )
    }

    await connectDB()

    const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
    if (!cashAccount) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Cash account not found' },
        { status: 404 }
      )
    }

    await CashTransaction.deleteMany({})
    let cashDoc = await Cash.findOne().lean()
    if (!cashDoc) {
      await Cash.create({ balance: 0 })
      cashDoc = await Cash.findOne().lean()
    }

    const bankTxs = await BankTransaction.find({ bankAccount: cashAccount._id })
      .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1 })
      .lean()

    const toCreate: {
      type: 'credit' | 'debit'
      amount: number
      description: string
      date: Date
      category: CashTransactionCategory
      referenceId?: mongoose.Types.ObjectId
      referenceType?: string
      isReversal?: boolean
      sortOrder: number
    }[] = []

    for (const tx of bankTxs) {
      const source = (tx.source as string) ?? 'other'
      const sourceLabel = (tx.sourceLabel as string) ?? source
      const isReversal = /Reversal|reversal/i.test(sourceLabel) || (tx as { sortOrder?: number }).sortOrder === 1
      toCreate.push({
        type: tx.type as 'credit' | 'debit',
        amount: tx.amount as number,
        description: sourceLabel,
        date: new Date((tx.transactionDate as Date)),
        category: mapSourceToCategory(source),
        referenceId: tx.sourceRef as mongoose.Types.ObjectId | undefined,
        referenceType: source === 'payment_receipt' ? 'PaymentReceipt' : source === 'expense' ? 'Expense' : source === 'cashbook_sale' ? 'SellBill' : undefined,
        isReversal,
        sortOrder: isReversal ? 1 : 0,
      })
    }

    if (toCreate.length > 0) {
      await CashTransaction.insertMany(
        toCreate.map((t) => ({
          ...t,
          referenceId: t.referenceId ?? null,
          referenceType: t.referenceType ?? null,
        }))
      )
    }

    const newBalance = cashAccount.currentBalance ?? 0
    await Cash.findOneAndUpdate({}, { $set: { balance: newBalance } })
    cashAccount.currentBalance = newBalance
    await cashAccount.save()

    return NextResponse.json({
      success: true,
      data: {
        migrated: toCreate.length,
        currentBalance: newBalance,
        message: `Rebuilt ${toCreate.length} cash transaction(s). Balance: ${newBalance}.`,
      },
    })
  } catch (error) {
    console.error('Rebuild cash transactions API Error:', error)
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
