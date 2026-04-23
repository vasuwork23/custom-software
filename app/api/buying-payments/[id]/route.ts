import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'
import { recalcBuyingEntryGivenAndStatus } from '@/lib/buying-entry-payments'
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
    const payment = await BuyingPayment.findById(id).lean()
    if (!payment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Payment not found' },
        { status: 404 }
      )
    }

    const entry = await BuyingEntry.findById(payment.buyingEntry).populate('product', 'productName').lean()
    const productName = entry ? (entry.product as { productName?: string })?.productName ?? 'Product' : 'Product'
    const entryDateStr = entry ? format(new Date(entry.entryDate), 'dd MMM yyyy') : ''
    const sourceLabel = `Reversal: Payment for ${productName} - ${entryDateStr}`

    const createdBy = await resolveCreatedBy(user.id)
    const personId = payment.chinaPerson as mongoose.Types.ObjectId
    const lastTx = await ChinaPersonTransaction.findOne({ chinaPerson: personId })
      .sort({ createdAt: -1 })
      .select('balanceAfter')
      .lean()
    const lastBalance = lastTx?.balanceAfter ?? 0
    const newBalance = lastBalance + payment.amount

    await ChinaPersonTransaction.create({
      chinaPerson: personId,
      type: 'pay_in',
      amount: payment.amount,
      balanceAfter: newBalance,
      transactionDate: new Date(),
      notes: sourceLabel,
      sourceLabel,
      createdBy,
    })
    await ChinaPerson.findByIdAndUpdate(personId, {
      currentBalance: newBalance,
      updatedBy: createdBy,
    })

    const buyingEntryId = payment.buyingEntry as mongoose.Types.ObjectId
    await BuyingPayment.findByIdAndDelete(id)
    await recalcBuyingEntryGivenAndStatus(buyingEntryId)

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Buying payment delete API Error:', error)
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
