import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import BuyingEntry from '@/models/BuyingEntry'
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

    // If this is a BuyingEntry *advance* payment, we need to update the BuyingEntry too.
    // Advance transactions are created as ChinaPersonTransaction(type='pay_out') without a
    // `buyingPayment` reference, while recalcBuyingEntryGivenAndStatus() depends on:
    // - `entry.hasAdvancePayment`
    // - `entry.advanceAmount`
    if (!buyingPaymentId && tx.type === 'pay_out') {
      const candidates = await BuyingEntry.find({
        hasAdvancePayment: true,
        advanceChinaPerson: personId,
        advanceAmount: tx.amount,
      })
        .lean()
        .exec()

      if (candidates.length > 0) {
        const txMs = tx.transactionDate ? new Date(tx.transactionDate).getTime() : Date.now()

        // Pick the closest entry by date (advanceDate if present; otherwise entryDate).
        // Tie-breaker: exact advanceNote match.
        let bestId: mongoose.Types.ObjectId | null = null
        let bestScore = Number.POSITIVE_INFINITY
        let bestNoteMatch = false

        for (const c of candidates) {
          const cDate = c.advanceDate ?? c.entryDate
          const cMs = cDate ? new Date(cDate).getTime() : 0
          const diffMs = Math.abs(cMs - txMs)
          const noteMatch = String(c.advanceNote ?? '') === String(tx.notes ?? '')

          // Prefer note matches; if both are same category choose smaller time diff.
          const score = diffMs
          if (!bestId) {
            bestId = c._id as mongoose.Types.ObjectId
            bestScore = score
            bestNoteMatch = noteMatch
            continue
          }

          if (noteMatch && !bestNoteMatch) {
            bestId = c._id as mongoose.Types.ObjectId
            bestScore = score
            bestNoteMatch = noteMatch
            continue
          }

          if (noteMatch === bestNoteMatch && score < bestScore) {
            bestId = c._id as mongoose.Types.ObjectId
            bestScore = score
          }
        }

        if (bestId) {
          await BuyingEntry.findByIdAndUpdate(bestId, {
            $set: { hasAdvancePayment: false, givenAmount: 0 },
            $unset: {
              advanceAmount: '',
              advanceChinaPerson: '',
              advanceDate: '',
              advanceNote: '',
            },
          })
          await recalcBuyingEntryGivenAndStatus(bestId)
        }
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
