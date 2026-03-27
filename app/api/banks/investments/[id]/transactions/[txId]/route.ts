import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Investment from '@/models/Investment'
import InvestmentTransaction from '@/models/InvestmentTransaction'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
import BankAccount from '@/models/BankAccount'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; txId: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { id, txId } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid investor id' },
        { status: 400 }
      )
    }
    if (!txId || !mongoose.Types.ObjectId.isValid(txId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid transaction id' },
        { status: 400 }
      )
    }

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)
    const investmentId = new mongoose.Types.ObjectId(id)
    const txObjectId = new mongoose.Types.ObjectId(txId)

    const investment = await Investment.findById(investmentId).lean()
    if (!investment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investor not found' },
        { status: 404 }
      )
    }

    const tx = await InvestmentTransaction.findById(txObjectId).lean()
    if (!tx || tx.investment.toString() !== id) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investment transaction not found' },
        { status: 404 }
      )
    }

    // Remove linked cashbook transaction and reverse aggregate cash balance.
    const cashTx = await CashTransaction.findOne({
      referenceType: 'investment_transaction',
      referenceId: txObjectId,
    }).lean()

    if (cashTx) {
      const delta = cashTx.type === 'credit' ? -cashTx.amount : cashTx.amount
      const updatedCash = await Cash.findOneAndUpdate({}, { $inc: { balance: delta } }, { new: true }).lean()
      const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
      if (cashAccount && updatedCash) {
        cashAccount.currentBalance = updatedCash.balance
        cashAccount.updatedBy = updatedBy
        await cashAccount.save()
      }
      await CashTransaction.findByIdAndDelete(cashTx._id)
    }

    await InvestmentTransaction.findByIdAndDelete(txObjectId)

    // Recalculate running balances for remaining transactions to preserve data integrity.
    const remaining = await InvestmentTransaction.find({ investment: investmentId })
      .sort({ transactionDate: 1, createdAt: 1 })
      .lean()

    let running = 0
    for (const row of remaining) {
      running += row.type === 'add' ? row.amount : -row.amount
      if (row.balanceAfter !== running) {
        await InvestmentTransaction.findByIdAndUpdate(row._id, { balanceAfter: running })
      }
    }

    await Investment.findByIdAndUpdate(investmentId, {
      currentBalance: running,
      updatedBy,
    })

    return NextResponse.json({
      success: true,
      data: { newBalance: running },
      message: 'Investment transaction deleted',
    })
  } catch (error) {
    console.error('Investment transaction delete API Error:', error)
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
