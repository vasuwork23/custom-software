import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaBankTransaction, { type IChinaBankTransaction } from '@/models/ChinaBankTransaction'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function DELETE(
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
        { success: false, error: 'Invalid id', message: 'Invalid transaction id' },
        { status: 400 }
      )
    }

    await connectDB()

    const tx = await ChinaBankTransaction.findById(id).lean<IChinaBankTransaction | null>()
    if (!tx) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Transaction not found' },
        { status: 404 }
      )
    }

    // Only allow deleting payment-like credits without linked buying entry
    if (tx.type !== 'credit') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Only credit entries can be deleted',
        },
        { status: 403 }
      )
    }

    if (tx.buyingEntry) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete entries linked to buying entries',
        },
        { status: 403 }
      )
    }

    const deletedAmount = tx.amount

    // Step 0: if no payFrom info, fall back to just reversing China Bank ledger
    if (!tx.payFrom) {
      const subsequent = await ChinaBankTransaction.find({
        createdAt: { $gt: tx.createdAt },
      })
        .sort({ createdAt: 1 })
        .lean()

      await ChinaBankTransaction.findByIdAndDelete(id)

      for (const s of subsequent) {
        const newBalanceAfter = s.balanceAfter - deletedAmount
        await ChinaBankTransaction.updateOne(
          { _id: s._id },
          { $set: { balanceAfter: newBalanceAfter } }
        )
      }

      console.warn('ChinaBankTransaction has no payFrom; reversed China Bank only')

      return NextResponse.json({
        success: true,
        data: { deleted: id },
        warning:
          'China Bank ledger reversed but source cash/bank could not be determined. Please adjust manually.',
      })
    }

    // Step 1 — reverse China Bank running balances (same as before)
    const subsequent = await ChinaBankTransaction.find({
      createdAt: { $gt: tx.createdAt },
    })
      .sort({ createdAt: 1 })
      .lean()

    await ChinaBankTransaction.findByIdAndDelete(id)

    for (const s of subsequent) {
      const newBalanceAfter = s.balanceAfter - deletedAmount
      await ChinaBankTransaction.updateOne(
        { _id: s._id },
        { $set: { balanceAfter: newBalanceAfter } }
      )
    }

    // Step 2 — reverse the SOURCE that was debited
    const createdBy = await resolveCreatedBy(user.id)
    const txDate = tx.transactionDate

    if (tx.payFrom === 'cash') {
      // Restore cash balance
      const updatedCash = await Cash.findOneAndUpdate(
        {},
        { $inc: { balance: deletedAmount } },
        { new: true }
      ).lean()

      // Also sync default cash BankAccount currentBalance if exists
      const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
      if (cashAccount && updatedCash) {
        cashAccount.currentBalance = updatedCash.balance
        cashAccount.updatedBy = createdBy
        await cashAccount.save()
      }

      // Create reversal cash transaction so history is correct
      await CashTransaction.create({
        type: 'credit',
        amount: deletedAmount,
        description: 'Reversal — China Bank payment deleted',
        date: new Date(),
        category: 'reversal',
        isReversal: true,
        reversalOf: undefined,
        sortOrder: 1,
      })
    } else if (tx.payFrom === 'bank' && tx.sourceBankAccountId) {
      const bankAccountId = tx.sourceBankAccountId
      const bankAccount = await BankAccount.findById(bankAccountId)

      if (bankAccount) {
        const newBalance = (bankAccount.currentBalance ?? 0) + deletedAmount
        bankAccount.currentBalance = newBalance
        bankAccount.updatedBy = createdBy
        await bankAccount.save()

        await BankTransaction.create({
          bankAccount: bankAccount._id,
          type: 'credit',
          amount: deletedAmount,
          balanceAfter: newBalance,
          source: 'china_bank_payment',
          sourceRef: undefined,
          sourceLabel: 'Reversal — China Bank payment deleted',
          transactionDate: txDate,
          notes: undefined,
          createdBy,
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: { deleted: id },
      message: 'Transaction deleted and source balance restored',
    })
  } catch (error) {
    console.error('China Bank delete transaction API Error:', error)
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
