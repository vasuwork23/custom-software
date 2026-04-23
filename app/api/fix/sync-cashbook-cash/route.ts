import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

/**
 * Sync Our Banks cash balance with cashbook sell bills.
 * Cash = BankAccount (type 'cash', isDefault: true).
 * Transactions = BankTransaction (source 'cashbook_sale').
 * Recomputes expected total from existing cashbook bills and adjusts cash by the difference.
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

    const cashbookBills = await SellBill.find({ isCashbook: true }).lean()
    const totalCashbookAmount = cashbookBills.reduce(
      (s, b) => s + ((b as { totalAmount?: number }).totalAmount ?? 0),
      0
    )

    const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
    if (!cashAccount) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Cash account not found' },
        { status: 404 }
      )
    }

    const cashbookTxs = await BankTransaction.find({
      bankAccount: cashAccount._id,
      source: 'cashbook_sale',
    }).lean()

    const totalExistingTx = cashbookTxs.reduce((s, tx) => {
      const amt = (tx.amount as number) ?? 0
      return s + (tx.type === 'credit' ? amt : -amt)
    }, 0)

    const diff = Math.round((totalCashbookAmount - totalExistingTx) * 100) / 100

    if (diff === 0) {
      return NextResponse.json({
        success: true,
        data: {
          synced: true,
          diff: 0,
          totalCashbookAmount,
          totalExistingTx,
          message: 'Cash already in sync with cashbook bills',
        },
      })
    }

    const createdBy = await resolveCreatedBy(user.id)
    const lastTx = await BankTransaction.findOne({ bankAccount: cashAccount._id })
      .sort({ transactionDate: -1, createdAt: -1 })
      .select('balanceAfter')
      .lean()
    const lastBalance = lastTx?.balanceAfter ?? cashAccount.currentBalance ?? 0
    const newBalance = lastBalance + diff

    await BankTransaction.create({
      bankAccount: cashAccount._id,
      type: diff > 0 ? 'credit' : 'debit',
      amount: Math.abs(diff),
      balanceAfter: newBalance,
      source: 'manual',
      sourceLabel: 'Sync cashbook cash — fix',
      transactionDate: new Date(),
      notes: `Adjustment: cashbook bills total ₹${totalCashbookAmount.toLocaleString('en-IN')}, tx net ₹${totalExistingTx.toLocaleString('en-IN')}`,
      createdBy,
    })

    cashAccount.currentBalance = newBalance
    cashAccount.updatedBy = createdBy
    await cashAccount.save()

    return NextResponse.json({
      success: true,
      data: {
        synced: true,
        diff,
        totalCashbookAmount,
        totalExistingTx,
        newCashBalance: newBalance,
        message: `Cash adjusted by ₹${Math.abs(diff).toLocaleString('en-IN')} (${diff > 0 ? 'credit' : 'debit'})`,
      },
    })
  } catch (error) {
    console.error('Sync cashbook cash API Error:', error)
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
