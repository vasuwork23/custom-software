import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import BuyingPayment from '@/models/BuyingPayment'
import { recalcBuyingEntryGivenAndStatus } from '@/lib/buying-entry-payments'
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
        { success: false, error: 'Validation failed', message: 'Invalid transaction id' },
        { status: 400 }
      )
    }

    await connectDB()
    const txId = new mongoose.Types.ObjectId(id)
    const tx = await ChinaPersonTransaction.findById(txId).lean()
    if (!tx) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Transaction not found' },
        { status: 404 }
      )
    }
    const isReversalFlag = (tx as { isReversal?: boolean }).isReversal === true
    const sourceLabel = (tx as { sourceLabel?: string }).sourceLabel ?? ''
    const notes = (tx as { notes?: string }).notes ?? ''
    const looksLikeReversal = /^Reversal\b/i.test(sourceLabel) || /\bReversal\b/i.test(notes)
    if (isReversalFlag || looksLikeReversal) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Reversal entries cannot be deleted' },
        { status: 400 }
      )
    }

    const personId = tx.chinaPerson as mongoose.Types.ObjectId
    const person = await ChinaPerson.findById(personId)
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }

    const buyingPaymentId = (tx as { buyingPayment?: mongoose.Types.ObjectId }).buyingPayment

    if (buyingPaymentId) {
      const payment = await BuyingPayment.findById(buyingPaymentId).lean()
      if (payment) {
        const entryId = payment.buyingEntry as mongoose.Types.ObjectId
        await BuyingPayment.findByIdAndDelete(buyingPaymentId)
        await recalcBuyingEntryGivenAndStatus(entryId)
      }
    }

    // Recalculate all remaining balances using the same chronological order
    // as the UI ("Date" column), so balanceAfter stays consistent after delete.
    const allTxs = await ChinaPersonTransaction.find({ chinaPerson: personId })
      .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1, _id: 1 })
      .exec()

    // Anchor balanceAfter recomputation to the stored currentBalance so the top
    // "Current Balance" stays consistent after delete.
    const anchorBalance = person.currentBalance ?? 0
    const sumDeltaAll = allTxs.reduce((acc, t) => {
      const delta = t.type === 'pay_in' ? t.amount : -t.amount
      return acc + delta
    }, 0)
    const startBalance = anchorBalance - sumDeltaAll

    let runningBalance = startBalance
    for (const t of allTxs) {
      if (String(t._id) === String(txId)) continue
      const delta = t.type === 'pay_in' ? t.amount : -t.amount
      runningBalance += delta
      t.balanceAfter = runningBalance
      await t.save()
    }

    await ChinaPersonTransaction.findByIdAndDelete(txId)
    await ChinaPerson.findByIdAndUpdate(personId, { currentBalance: runningBalance })

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Sophia transaction delete API Error:', error)
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
