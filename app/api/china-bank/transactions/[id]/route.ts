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

    // Only allow deleting credit (payments) or debit (withdrawals) without linked buying entry
    if (tx.type !== 'credit' && tx.type !== 'debit') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Only payment or transfer-out entries can be deleted',
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

    const isWithdrawal = tx.type === 'debit'

    // Step 0: if no payFrom/payTo info, fall back to just reversing China Bank ledger
    const hasSourceInfo = isWithdrawal ? !!tx.payTo : !!tx.payFrom
    if (!hasSourceInfo) {
      const subsequent = await ChinaBankTransaction.find({
        createdAt: { $gt: tx.createdAt },
      })
        .sort({ createdAt: 1 })
        .lean()

      await ChinaBankTransaction.findByIdAndDelete(id)

      for (const s of subsequent) {
        // credit deletion → subtract from subsequent; debit deletion → add back to subsequent
        const newBalanceAfter = isWithdrawal
          ? s.balanceAfter + deletedAmount
          : s.balanceAfter - deletedAmount
        await ChinaBankTransaction.updateOne(
          { _id: s._id },
          { $set: { balanceAfter: newBalanceAfter } }
        )
      }

      console.warn('ChinaBankTransaction has no payFrom/payTo; reversed China Bank only')

      return NextResponse.json({
        success: true,
        data: { deleted: id },
        warning:
          'China Bank ledger reversed but destination cash/bank could not be determined. Please adjust manually.',
      })
    }

    // Step 1 — reverse China Bank running balances
    const subsequent = await ChinaBankTransaction.find({
      createdAt: { $gt: tx.createdAt },
    })
      .sort({ createdAt: 1 })
      .lean()

    await ChinaBankTransaction.findByIdAndDelete(id)

    for (const s of subsequent) {
      const newBalanceAfter = isWithdrawal
        ? s.balanceAfter + deletedAmount
        : s.balanceAfter - deletedAmount
      await ChinaBankTransaction.updateOne(
        { _id: s._id },
        { $set: { balanceAfter: newBalanceAfter } }
      )
    }

    // Step 2 — reverse the account that was affected
    const createdBy = await resolveCreatedBy(user.id)
    const txDate = tx.transactionDate

    if (isWithdrawal) {
      // Withdrawal reversal: debit the destination account (undo the credit it received)
      if (tx.payTo === 'cash') {
        const updatedCash = await Cash.findOneAndUpdate(
          {},
          { $inc: { balance: -deletedAmount } },
          { new: true }
        ).lean()

        const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
        if (cashAccount && updatedCash) {
          cashAccount.currentBalance = updatedCash.balance
          cashAccount.updatedBy = createdBy
          await cashAccount.save()
        }

        await CashTransaction.create({
          type: 'debit',
          amount: deletedAmount,
          description: 'Reversal — China Bank transfer out deleted',
          date: new Date(),
          category: 'reversal',
          isReversal: true,
          reversalOf: undefined,
          sortOrder: 1,
        })
      } else if (tx.payTo === 'bank' && tx.destBankAccountId) {
        const bankAccount = await BankAccount.findById(tx.destBankAccountId)

        if (bankAccount) {
          const newBalance = (bankAccount.currentBalance ?? 0) - deletedAmount
          bankAccount.currentBalance = newBalance
          bankAccount.updatedBy = createdBy
          await bankAccount.save()

          await BankTransaction.create({
            bankAccount: bankAccount._id,
            type: 'debit',
            amount: deletedAmount,
            balanceAfter: newBalance,
            source: 'china_bank_withdrawal',
            sourceRef: undefined,
            sourceLabel: 'Reversal — China Bank transfer out deleted',
            transactionDate: txDate,
            notes: undefined,
            createdBy,
          })
        }
      }
    } else {
      // Payment reversal: credit the source account (undo the debit it had)
      if (tx.payFrom === 'cash') {
        const updatedCash = await Cash.findOneAndUpdate(
          {},
          { $inc: { balance: deletedAmount } },
          { new: true }
        ).lean()

        const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
        if (cashAccount && updatedCash) {
          cashAccount.currentBalance = updatedCash.balance
          cashAccount.updatedBy = createdBy
          await cashAccount.save()
        }

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
        const bankAccount = await BankAccount.findById(tx.sourceBankAccountId)

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
    }

    return NextResponse.json({
      success: true,
      data: { deleted: id },
      message: 'Transaction deleted and balance restored',
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
