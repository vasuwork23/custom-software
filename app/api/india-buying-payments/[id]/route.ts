import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'
import { recalcIndiaBuyingEntryGivenAndStatus } from '@/lib/india-buying-entry-payments'
import { format } from 'date-fns'

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
        { success: false, error: 'Invalid id', message: 'Invalid payment id' },
        { status: 400 }
      )
    }

    await connectDB()
    const payment = await IndiaBuyingPayment.findById(id).lean()
    if (!payment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Payment not found' },
        { status: 404 }
      )
    }

    const entry = await IndiaBuyingEntry.findById(payment.buyingEntry)
      .populate('product', 'productName')
      .lean()
    const productName = entry ? (entry.product as { productName?: string })?.productName ?? 'India Product' : 'India Product'
    const entryDateStr = entry ? format(new Date(entry.entryDate), 'dd MMM yyyy') : ''
    const sourceLabel = `Reversal: Payment for India Product: ${productName} - ${entryDateStr}`

    const createdBy = await resolveCreatedBy(user.id)
    const bankId = payment.bankAccount as mongoose.Types.ObjectId
    const bankAcct = await BankAccount.findById(bankId).select('type').lean()
    if (bankAcct?.type === 'cash') {
      const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
      await createCashTransaction({
        type: 'credit',
        amount: payment.amount,
        description: sourceLabel,
        date: new Date(),
        category: 'other',
        referenceId: payment._id as mongoose.Types.ObjectId,
        referenceType: 'india_buying_payment',
      })
    } else {
      const lastTx = await BankTransaction.findOne({ bankAccount: bankId })
        .sort({ transactionDate: -1, createdAt: -1 })
        .select('balanceAfter')
        .lean()
      const lastBalance = lastTx?.balanceAfter ?? 0
      const newBalance = lastBalance + payment.amount

      await BankTransaction.create({
        bankAccount: bankId,
        type: 'credit',
        amount: payment.amount,
        balanceAfter: newBalance,
        source: 'manual',
        sourceLabel,
        transactionDate: new Date(),
        createdBy,
      })
      await BankAccount.findByIdAndUpdate(bankId, { currentBalance: newBalance })
    }

    const buyingEntryId = payment.buyingEntry as mongoose.Types.ObjectId
    await IndiaBuyingPayment.findByIdAndDelete(id)
    await recalcIndiaBuyingEntryGivenAndStatus(buyingEntryId)

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('India buying payment delete API Error:', error)
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
