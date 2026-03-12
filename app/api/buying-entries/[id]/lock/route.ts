import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import Product from '@/models/Product'
import SellBillItem from '@/models/SellBillItem'
import mongoose from 'mongoose'
import { recalculateProfitForEntry } from '@/lib/recalculate-entry-profit'

/** Recompute actual soldCtn from FIFO so we don't skip China Bank debit when DB is stale */
function getActualSoldCtn(
  entryIdStr: string,
  allSellItems: { fifoBreakdown?: Record<string, unknown>[] }[]
): number {
  let actual = 0
  for (const item of allSellItems) {
    if (!item.fifoBreakdown || !Array.isArray(item.fifoBreakdown)) continue
    for (const fb of item.fifoBreakdown) {
      const fbId = (
        fb.buyingEntry != null ? String(fb.buyingEntry) :
        fb.buyingEntryId != null ? String(fb.buyingEntryId) :
        fb.entryId != null ? String(fb.entryId) :
        fb.entry != null ? String(fb.entry) :
        null
      )
      if (fbId === entryIdStr) {
        actual += Number(fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0)
      }
    }
  }
  return actual
}

export const dynamic = 'force-dynamic'

export async function POST(
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
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const entry = await BuyingEntry.findById(id)
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    if (
      !entry.avgRmbRate ||
      entry.avgRmbRate <= 0 ||
      !entry.carryingRate ||
      entry.carryingRate <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Avg RMB Rate and Carrying Rate must be greater than 0 to lock',
        },
        { status: 400 }
      )
    }

    if (entry.isLocked) {
      const debitTx = await ChinaBankTransaction.findOne({ buyingEntry: id, type: 'debit' }).sort({ createdAt: -1 })
      if (debitTx) {
        const lastTx = await ChinaBankTransaction.findOne().sort({ createdAt: -1 }).select('balanceAfter').lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        await ChinaBankTransaction.create({
          type: 'reversal',
          amount: debitTx.amount,
          balanceAfter: lastBalance + debitTx.amount,
          buyingEntry: entry._id,
          reference: `Reversal before re-lock - Entry ${id}`,
          transactionDate: new Date(),
          sortOrder: 1,
          createdBy,
        })
      }
      entry.isLocked = false
      entry.lockedAt = undefined
      entry.lockedCtn = 0
      entry.lockedAmount = 0
      await entry.save()
    }

    const body = await req.json().catch(() => ({}))
    const bodyChinaCtnRaw = body?.chinaWarehouseCtn
    const bodyTransitCtnRaw = body?.inTransitCtn

    const chinaWarehouseCtn =
      typeof bodyChinaCtnRaw === 'number' ? bodyChinaCtnRaw : entry.chinaWarehouseCtn ?? 0
    const inTransitCtn =
      typeof bodyTransitCtnRaw === 'number' ? bodyTransitCtnRaw : entry.inTransitCtn ?? 0

    // Use actual soldCtn from FIFO so re-lock correctly debits China Bank when there is available CTN
    const allSellItems = await SellBillItem.find({
      fifoBreakdown: { $exists: true, $ne: [] },
    }).lean()
    const actualSoldCtn = getActualSoldCtn(String(entry._id), allSellItems)
    entry.soldCtn = parseFloat(actualSoldCtn.toFixed(2))

    const availableCtnRounded = parseFloat(
      Math.max(0, entry.totalCtn - chinaWarehouseCtn - inTransitCtn - actualSoldCtn).toFixed(4)
    )
    const soldCtnRounded = parseFloat(actualSoldCtn.toFixed(4))

    // lockedCtn = available + sold (lock full amount for both)
    const lockedCtn = parseFloat((availableCtnRounded + soldCtnRounded).toFixed(4))

    if (lockedCtn <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'No CTN to lock (available + sold must be > 0). Adjust China WH / Transit CTN or add sales.',
        },
        { status: 400 }
      )
    }

    const lockAmount = parseFloat(
      ((entry.finalCost ?? 0) * (entry.qty ?? 0) * lockedCtn).toFixed(2)
    )

    entry.chinaWarehouseCtn = parseFloat(chinaWarehouseCtn.toFixed(2))
    entry.inTransitCtn = parseFloat(inTransitCtn.toFixed(2))
    entry.availableCtn = parseFloat(availableCtnRounded.toFixed(2))

    await entry.save()

    const lastTx = await ChinaBankTransaction.findOne().sort({ createdAt: -1 }).select('balanceAfter').lean()
    const lastBalance = lastTx?.balanceAfter ?? 0
    const product = await Product.findById(entry.product).select('productName').lean()
    const productName = product?.productName ?? entry.mark ?? 'Product'

    await ChinaBankTransaction.create({
      type: 'debit',
      amount: lockAmount,
      balanceAfter: lastBalance - lockAmount,
      buyingEntry: entry._id,
      reference: `Lock: ${productName} — ${lockedCtn} CTN (${availableCtnRounded} available + ${soldCtnRounded} sold)`,
      transactionDate: new Date(),
      createdBy,
    })

    entry.isLocked = true
    entry.lockedCtn = lockedCtn
    entry.lockedAmount = lockAmount
    entry.lockedAt = new Date()
    await entry.save()

    if (actualSoldCtn > 0) {
      await recalculateProfitForEntry(entry._id as mongoose.Types.ObjectId)
    }

    const updated = await BuyingEntry.findById(id).lean().populate('product', 'productName')
    return NextResponse.json({
      success: true,
      data: updated,
      message:
        actualSoldCtn > 0
          ? 'Entry locked. China Bank debited for full CTN (available + sold). Profits recalculated.'
          : 'Entry locked successfully.',
    })
  } catch (error) {
    console.error('Buying entry lock API Error:', error)
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
