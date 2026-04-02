import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import Product from '@/models/Product'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import SellBillItem from '@/models/SellBillItem'
import mongoose from 'mongoose'
import { format } from 'date-fns'
import { recalcBuyingEntryGivenAndStatus } from '@/lib/buying-entry-payments'
import { recalculateProfitForEntry } from '@/lib/recalculate-entry-profit'

export const dynamic = 'force-dynamic'

export async function GET(
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

    const entry = await BuyingEntry.findById(id).lean().populate('product', 'productName')
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    // Live soldCtn from FIFO so edit form always shows correct value
    const allSellItems = await SellBillItem.find({
      fifoBreakdown: { $exists: true, $ne: [] },
    }).lean()
    let liveSoldCtn = 0
    const entryIdStr = String(id)
    for (const item of allSellItems) {
      if (!item.fifoBreakdown || !Array.isArray(item.fifoBreakdown)) continue
      for (const fb of item.fifoBreakdown as Record<string, unknown>[]) {
        const fbEntryId = (
          fb.buyingEntry != null ? String(fb.buyingEntry) :
          fb.buyingEntryId != null ? String(fb.buyingEntryId) :
          fb.entryId != null ? String(fb.entryId) :
          fb.entry != null ? String(fb.entry) :
          null
        )
        if (fbEntryId === entryIdStr) {
          liveSoldCtn += Number(fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0)
        }
      }
    }
    const liveAvailableCtn = parseFloat(
      Math.max(
        0,
        (entry.totalCtn ?? 0) - (entry.chinaWarehouseCtn ?? 0) - (entry.inTransitCtn ?? 0) - liveSoldCtn
      ).toFixed(2)
    )

    return NextResponse.json({
      success: true,
      data: {
        ...entry,
        soldCtn: parseFloat(liveSoldCtn.toFixed(2)),
        availableCtn: liveAvailableCtn,
      },
    })
  } catch (error) {
    console.error('Buying entry get API Error:', error)
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

export async function PUT(
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
    const body = await req.json()

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    let entry = await BuyingEntry.findById(id)
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    // Recalculate actual soldCtn from FIFO records (same logic as fix route — handle all field name variants)
    const allSellItems = await SellBillItem.find({
      fifoBreakdown: { $exists: true, $ne: [] },
    }).lean()
    let actualSoldCtn = 0
    const entryIdStr = String(entry._id)
    for (const item of allSellItems) {
      if (!item.fifoBreakdown || !Array.isArray(item.fifoBreakdown)) continue
      for (const fb of item.fifoBreakdown as Record<string, unknown>[]) {
        const fbEntryId = (
          fb.buyingEntry != null ? String(fb.buyingEntry) :
          fb.buyingEntryId != null ? String(fb.buyingEntryId) :
          fb.entryId != null ? String(fb.entryId) :
          fb.entry != null ? String(fb.entry) :
          null
        )
        if (fbEntryId === entryIdStr) {
          actualSoldCtn += Number(
            fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0
          )
        }
      }
    }
    entry.soldCtn = parseFloat((actualSoldCtn).toFixed(2))
    const effectiveChinaWhCtn =
      entry.chinaWarehouseReceived === 'yes'
        ? (entry.chinaWarehouseCtn ?? 0)
        : (entry.totalCtn ?? 0)
    entry.availableCtn = parseFloat(
      Math.max(
        0,
        (entry.totalCtn ?? 0) -
          effectiveChinaWhCtn -
          (entry.inTransitCtn ?? 0) -
          actualSoldCtn
      ).toFixed(2)
    )
    // Only block reducing total CTN below what's already sold
    if (body.totalCtn != null && Number(body.totalCtn) < actualSoldCtn) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Cannot reduce Total CTN below ${actualSoldCtn} (already sold)`,
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
          buyingEntry: id,
          reference: `Reversal for edit - Entry ${id}`,
          transactionDate: new Date(),
          sortOrder: 1,
          createdBy: updatedBy,
        })
      }
      entry.isLocked = false
      entry.lockedAt = undefined
    }

    if (body.totalCtn != null) entry.totalCtn = Number(body.totalCtn)
    if (body.qty != null) entry.qty = Number(body.qty)
    if (body.rate != null) entry.rate = Number(body.rate)
    if (body.cbm != null) entry.cbm = Number(body.cbm)
    if (body.weight != null) entry.weight = Number(body.weight)
    if (body.mark != null) {
      const nextMark = String(body.mark).trim()
      if (!nextMark) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: 'Mark is required' },
          { status: 400 }
        )
      }
      entry.mark = nextMark
    }
    if (body.hasAdvancePayment !== undefined) entry.hasAdvancePayment = Boolean(body.hasAdvancePayment)
    if (body.hasAdvancePayment === false) {
      const oldAdvancePerson = entry.advanceChinaPerson
      const oldAdvanceAmt = entry.advanceAmount ?? 0
      entry.advanceAmount = undefined
      entry.advanceChinaPerson = undefined
      entry.advanceDate = undefined
      entry.advanceNote = undefined
      if (oldAdvancePerson && oldAdvanceAmt > 0) {
        const product = await Product.findById(entry.product).select('productName').lean()
        const productName = product?.productName ?? 'Product'
        const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
        const sourceLabel = `Reversal: Advance for ${productName} - ${entryDateStr}`

        const reversedPerson = await ChinaPerson.findByIdAndUpdate(
          oldAdvancePerson,
          { $inc: { currentBalance: Number(oldAdvanceAmt) }, updatedBy },
          { new: true, select: 'currentBalance' }
        )
        const balanceAfterReverse =
          (reversedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

        await ChinaPersonTransaction.create({
          chinaPerson: oldAdvancePerson,
          type: 'pay_in',
          amount: oldAdvanceAmt,
          balanceAfter: balanceAfterReverse,
          transactionDate: new Date(),
          notes: sourceLabel,
          sourceLabel,
          sortOrder: 1,
          isReversal: true,
          createdBy: updatedBy,
        })
      }
    } else {
      const oldAdvancePerson = entry.advanceChinaPerson
      const oldAdvanceAmt = entry.advanceAmount ?? 0
      if (body.advanceChinaPerson !== undefined) {
        entry.advanceChinaPerson =
          body.advanceChinaPerson == null || body.advanceChinaPerson === ''
            ? undefined
            : body.advanceChinaPerson
      }
      if (body.advanceAmount !== undefined) {
        entry.advanceAmount =
          body.advanceAmount == null || body.advanceAmount === ''
            ? undefined
            : Number(body.advanceAmount)
      }
      if (body.advanceDate !== undefined) {
        entry.advanceDate =
          body.advanceDate == null || body.advanceDate === ''
            ? undefined
            : new Date(body.advanceDate)
      }
      if (body.advanceNote !== undefined) {
        entry.advanceNote =
          body.advanceNote == null || body.advanceNote === ''
            ? undefined
            : String(body.advanceNote)
      }
      const newAdvanceAmt = entry.hasAdvancePayment ? (entry.advanceAmount ?? 0) : 0
      const newAdvancePerson = entry.advanceChinaPerson
      const advanceChanged =
        oldAdvanceAmt !== newAdvanceAmt ||
        (oldAdvancePerson && newAdvancePerson && String(oldAdvancePerson) !== String(newAdvancePerson))

      // Step 1 — reverse OLD advance first
      if (advanceChanged && oldAdvancePerson && oldAdvanceAmt > 0) {
        const product = await Product.findById(entry.product).select('productName').lean()
        const productName = product?.productName ?? 'Product'
        const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
        const sourceLabel = `Reversal: Advance for ${productName} - ${entryDateStr}`

        const reversedPerson = await ChinaPerson.findByIdAndUpdate(
          oldAdvancePerson,
          { $inc: { currentBalance: Number(oldAdvanceAmt) }, updatedBy },
          { new: true, select: 'currentBalance' }
        )
        const balanceAfterReverse =
          (reversedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

        await ChinaPersonTransaction.create({
          chinaPerson: oldAdvancePerson,
          type: 'pay_in',
          amount: oldAdvanceAmt,
          balanceAfter: balanceAfterReverse,
          transactionDate: new Date(),
          notes: `Reversal: Advance for ${productName} - ${entryDateStr}`,
          sourceLabel,
          sortOrder: 1,
          isReversal: true,
          createdBy: updatedBy,
        })
      }

      // Step 2 — apply NEW advance
      if (advanceChanged && newAdvanceAmt > 0 && newAdvancePerson) {
        const product = await Product.findById(entry.product).select('productName').lean()
        const productName = product?.productName ?? 'Product'
        const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
        const sourceLabel = `Advance for ${productName} - ${entryDateStr}`
        const personId = typeof newAdvancePerson === 'object' && newAdvancePerson != null ? newAdvancePerson : new mongoose.Types.ObjectId(String(newAdvancePerson))

        const debitedPerson = await ChinaPerson.findByIdAndUpdate(
          personId,
          { $inc: { currentBalance: -Number(newAdvanceAmt) }, updatedBy },
          { new: true, select: 'currentBalance' }
        )
        const balanceAfterDebit =
          (debitedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

        await ChinaPersonTransaction.create({
          chinaPerson: personId,
          type: 'pay_out',
          amount: newAdvanceAmt,
          balanceAfter: balanceAfterDebit,
          transactionDate: new Date(),
          notes: entry.advanceNote,
          sourceLabel,
          createdBy: updatedBy,
        })
      }
    }
    if (body.carryingRate !== undefined) entry.carryingRate = body.carryingRate == null ? undefined : Number(body.carryingRate)
    if (body.avgRmbRate !== undefined) entry.avgRmbRate = body.avgRmbRate == null ? undefined : Number(body.avgRmbRate)
    if (body.entryDate != null) entry.entryDate = new Date(body.entryDate)

    if (body.chinaWarehouseReceived != null) {
      entry.chinaWarehouseReceived = body.chinaWarehouseReceived === 'yes' ? 'yes' : 'no'
    }
    if (body.chinaWarehouseCtn != null) {
      entry.chinaWarehouseCtn = Number(body.chinaWarehouseCtn)
    }
    if (body.inTransitCtn != null) {
      entry.inTransitCtn = Number(body.inTransitCtn)
    }

    // Validate warehouse split against sold CTN
    const safeTotal = entry.totalCtn ?? 0
    const safeSold = entry.soldCtn ?? 0
    const maxAssignable = Math.max(0, safeTotal - safeSold)
    const chinaCtn = entry.chinaWarehouseCtn ?? 0
    const transitCtn = entry.inTransitCtn ?? 0
    if (chinaCtn + transitCtn > maxAssignable) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `China Warehouse CTN + In Transit CTN cannot exceed ${maxAssignable} CTN (${safeSold} already sold)`,
        },
        { status: 400 }
      )
    }

    // Recalculate availableCtn based on total, warehouse split and sold (round to 2 decimals)
    entry.availableCtn = parseFloat(
      Math.max(0, safeTotal - chinaCtn - transitCtn - safeSold).toFixed(2)
    )

    entry.updatedBy = updatedBy

    await entry.save()
    await recalcBuyingEntryGivenAndStatus(new mongoose.Types.ObjectId(id))

    if (actualSoldCtn > 0) {
      await recalculateProfitForEntry(entry._id as mongoose.Types.ObjectId)
    }

    const updated = await BuyingEntry.findById(id).lean().populate('product', 'productName')
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Buying entry update API Error:', error)
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
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await BuyingEntry.findById(id).populate('product', 'productName').lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    // Step 1 — block delete if any sell bill items are linked to this entry (directly or via FIFO)
    const entryObjectId = new mongoose.Types.ObjectId(id)
    const sellBillCount = await SellBillItem.countDocuments({
      $or: [
        { buyingEntryId: entryObjectId },
        { 'fifoBreakdown.buyingEntry': entryObjectId },
        { 'fifoBreakdown.buyingEntryId': entryObjectId },
        { 'fifoBreakdown.entryId': entryObjectId },
        { 'fifoBreakdown.entry': entryObjectId },
      ],
    })

    if (sellBillCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: `Cannot delete — ${sellBillCount} sell bill(s) linked to this entry. Delete those first.`,
        },
        { status: 403 }
      )
    }

    const updatedBy = await resolveCreatedBy(user.id)
    const mark = (entry as { mark?: string }).mark ?? id
    const productName = (entry as { product?: { productName?: string } }).product?.productName ?? ''
    const entryDate = (entry as { entryDate?: Date }).entryDate
    const description = productName ? `Reversal — ${mark} (${productName})` : `Reversal — ${mark}`

    // Step 2 — Restore advance payment to China Person (reverse the pay_out done on create)
    const hasAdvance =
      (entry as { hasAdvancePayment?: boolean }).hasAdvancePayment === true &&
      Number((entry as { advanceAmount?: number }).advanceAmount) > 0
    const advanceChinaPersonId = (entry as { advanceChinaPerson?: mongoose.Types.ObjectId }).advanceChinaPerson

    if (hasAdvance && advanceChinaPersonId) {
      const advanceAmount = Number((entry as { advanceAmount?: number }).advanceAmount)
      const person = await ChinaPerson.findById(advanceChinaPersonId).lean()
      if (person) {
        const currentBalance = (person as { currentBalance?: number }).currentBalance ?? 0
        const newBalance = currentBalance + advanceAmount
        await ChinaPersonTransaction.create({
          chinaPerson: advanceChinaPersonId,
          type: 'pay_in',
          amount: advanceAmount,
          balanceAfter: newBalance,
          // Use delete date (today) so the reversal appears on the actual delete day
          // and keeps chronological ledger ordering consistent.
          transactionDate: new Date(),
          sourceLabel: description,
          notes: 'Advance restored (entry deleted)',
          isReversal: true,
          sortOrder: 1,
          createdBy: updatedBy,
        })
        await ChinaPerson.findByIdAndUpdate(advanceChinaPersonId, {
          currentBalance: newBalance,
          updatedBy,
        })
      }
    }

    // Step 3 — Reverse ALL additional payments (BuyingPayment) — restore each to China Person
    const additionalPayments = await BuyingPayment.find({ buyingEntry: entryObjectId }).lean()
    for (const payment of additionalPayments) {
      const personId = payment.chinaPerson as mongoose.Types.ObjectId
      const person = await ChinaPerson.findById(personId).lean()
      if (!person) continue
      const currentBalance = (person as { currentBalance?: number }).currentBalance ?? 0
      const newBalance = currentBalance + payment.amount
      const originalPayOut = await ChinaPersonTransaction.findOne({
        buyingPayment: payment._id,
        type: 'pay_out',
        isReversal: { $ne: true },
      })
        .sort({ createdAt: 1 })
        .select('transactionDate')
        .lean()
      const originalDate = originalPayOut
        ? (originalPayOut as { transactionDate?: Date }).transactionDate
        : (payment as { paymentDate?: Date }).paymentDate ?? entryDate
      await ChinaPersonTransaction.create({
        chinaPerson: personId,
        type: 'pay_in',
        amount: payment.amount,
        balanceAfter: newBalance,
        // Use delete date (today) so this restored payment appears when the entry was deleted.
        transactionDate: new Date(),
        sourceLabel: description,
        notes: 'Payment restored (entry deleted)',
        isReversal: true,
        reversalOf: originalPayOut?._id ?? undefined,
        sortOrder: 1,
        createdBy: updatedBy,
      })
      await ChinaPerson.findByIdAndUpdate(personId, {
        currentBalance: newBalance,
        updatedBy,
      })
    }
    await BuyingPayment.deleteMany({ buyingEntry: entryObjectId })

    // Step 4 — Reverse China Bank lock if locked
    if (entry.isLocked) {
      const debitTx = await ChinaBankTransaction.findOne({ buyingEntry: id, type: 'debit' }).sort({ createdAt: -1 })
      if (debitTx) {
        const lastTx = await ChinaBankTransaction.findOne().sort({ createdAt: -1 }).select('balanceAfter').lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const originalDate = (debitTx as { transactionDate?: Date }).transactionDate
        await ChinaBankTransaction.create({
          type: 'reversal',
          amount: debitTx.amount,
          balanceAfter: lastBalance + debitTx.amount,
          buyingEntry: id,
          reference: `Reversal for delete - Entry ${id}`,
          transactionDate: new Date(),
          sortOrder: 1,
          createdBy: updatedBy,
        })
      }
    }

    await BuyingEntry.findByIdAndDelete(id)
    const advanceAmount = hasAdvance ? Number((entry as { advanceAmount?: number }).advanceAmount) : 0
    const additionalTotal = additionalPayments.reduce((s, p) => s + p.amount, 0)
    return NextResponse.json({
      success: true,
      data: {
        deleted: id,
        reversals: {
          advanceReversed: advanceAmount,
          additionalPaymentsReversed: additionalPayments.length,
          additionalAmountReversed: additionalTotal,
          totalAmountReversed: advanceAmount + additionalTotal,
          lockReversed: (entry as { isLocked?: boolean }).isLocked ?? false,
        },
      },
    })
  } catch (error) {
    console.error('Buying entry delete API Error:', error)
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
