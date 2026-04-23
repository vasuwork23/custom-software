import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import BankTransaction from '@/models/BankTransaction'
import BankAccount from '@/models/BankAccount'
import IndiaProduct from '@/models/IndiaProduct'

export const dynamic = 'force-dynamic'

/** One-time cleanup for India buying advances: ensure exactly one debit per entry and rebuild balances. */
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

    const entries = await IndiaBuyingEntry.find({
      hasAdvancePayment: true,
      advanceAmount: { $gt: 0 },
      advanceBankAccount: { $ne: null },
    })
      .select('advanceAmount advanceBankAccount product createdAt')
      .lean()

    const affectedBankIds = new Set<string>()

    for (const entry of entries) {
      const bankId = String(entry.advanceBankAccount as mongoose.Types.ObjectId)
      affectedBankIds.add(bankId)

      // Delete all existing advance transactions for this entry.
      // We key on sourceRef = entry._id and source = 'india_buying_advance'.
      // eslint-disable-next-line no-await-in-loop
      await BankTransaction.deleteMany({
        source: 'india_buying_advance',
        sourceRef: entry._id,
      })

      const product = await IndiaProduct.findById(entry.product)
        .select('productName')
        .lean()
      const productName = product?.productName ?? 'India Product'

      // Create a single clean debit transaction for the current advanceAmount.
      const amount = Number(entry.advanceAmount ?? 0)
      if (amount <= 0) continue

      // eslint-disable-next-line no-await-in-loop
      await BankTransaction.create({
        bankAccount: bankId,
        type: 'debit',
        amount,
        source: 'india_buying_advance',
        sourceLabel: `Advance for India buying entry — ${productName}`,
        sourceRef: entry._id,
        transactionDate: (entry as { createdAt?: Date }).createdAt ?? new Date(),
        createdAt: (entry as { createdAt?: Date }).createdAt ?? new Date(),
        sortOrder: 0,
      })
    }

    // Rebuild balanceAfter and currentBalance for each affected bank account.
    for (const bankId of Array.from(affectedBankIds)) {
      const txns = await BankTransaction.find({ bankAccount: bankId })
        .sort({ transactionDate: 1, createdAt: 1, _id: 1 })
        .lean()

      let balance = 0
      for (const tx of txns) {
        balance += tx.type === 'credit' ? Number(tx.amount) : -Number(tx.amount)
        // eslint-disable-next-line no-await-in-loop
        await BankTransaction.findByIdAndUpdate(tx._id, {
          $set: { balanceAfter: balance },
        })
      }

      await BankAccount.findByIdAndUpdate(bankId, {
        $set: { currentBalance: balance },
      })
    }

    return NextResponse.json({
      success: true,
      data: { entriesFixed: entries.length, bankAccountsUpdated: affectedBankIds.size },
      message: 'India advance transactions normalized successfully',
    })
  } catch (error) {
    console.error('Fix India advance txns API Error:', error)
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

