import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CashTransaction from '@/models/CashTransaction'
import Cash from '@/models/Cash'
import BankAccount from '@/models/BankAccount'

export const dynamic = 'force-dynamic'

/**
 * Finds "Reversal — Cashbook bill deleted #N" CashTransaction entries that have no
 * matching original credit (i.e. the bill's creation was interrupted before the
 * original "Cashbook sale" credit was ever written, so the reversal-on-delete had
 * nothing real to reverse). Deletes those orphaned debits and undoes their effect
 * on the cash balance. Pass { "dryRun": true } to preview without making changes.
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

    let dryRun = false
    try {
      const body = await req.json()
      dryRun = body?.dryRun === true
    } catch {
      // no body provided — treat as apply
    }

    await connectDB()

    const candidates = await CashTransaction.find({
      isReversal: true,
      category: 'reversal',
      referenceType: 'SellBill',
    }).lean()

    const orphans: typeof candidates = []
    for (const c of candidates) {
      if (c.reversalOf) {
        const originalStillExists = await CashTransaction.exists({ _id: c.reversalOf })
        if (originalStillExists) continue
      }
      const anyOriginalCredit = await CashTransaction.exists({
        referenceId: c.referenceId,
        referenceType: 'SellBill',
        isReversal: { $ne: true },
      })
      if (anyOriginalCredit) continue
      orphans.push(c)
    }

    const preview = orphans.map((o) => ({
      id: String(o._id),
      description: o.description,
      amount: o.amount,
      date: o.date,
    }))

    if (dryRun || orphans.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          scanned: candidates.length,
          orphansFound: orphans.length,
          removed: dryRun ? [] : preview,
          preview: dryRun ? preview : undefined,
          message:
            orphans.length === 0
              ? 'No orphaned reversal entries found.'
              : `Found ${orphans.length} orphaned reversal(s). Dry run — nothing changed.`,
        },
      })
    }

    for (const o of orphans) {
      const undoDelta = o.type === 'credit' ? -o.amount : o.amount

      const cash = await Cash.findOne().lean()
      const newBalance = (cash?.balance ?? 0) + undoDelta
      await Cash.findOneAndUpdate({}, { $inc: { balance: undoDelta } })

      const cashAccount = await BankAccount.findOne({ type: 'cash', isDefault: true })
      if (cashAccount) {
        cashAccount.currentBalance = newBalance
        await cashAccount.save()
      }

      await CashTransaction.findByIdAndDelete(o._id)
    }

    return NextResponse.json({
      success: true,
      data: {
        scanned: candidates.length,
        orphansFound: orphans.length,
        removed: preview,
        message: `Removed ${orphans.length} orphaned reversal entr${orphans.length === 1 ? 'y' : 'ies'} and restored ₹${orphans
          .reduce((s, o) => s + o.amount, 0)
          .toLocaleString('en-IN')} to the cash balance.`,
      },
    })
  } catch (error) {
    console.error('Remove orphaned cashbook reversals API Error:', error)
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
