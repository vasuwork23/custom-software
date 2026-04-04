import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import Company from '@/models/Company'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import CashTransaction from '@/models/CashTransaction'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import { processFIFO, reverseFIFO, applyFIFO } from '@/lib/fifo'
import { processIndiaFIFO, reverseIndiaFIFO, applyIndiaFIFO } from '@/lib/india-fifo'
import { round } from '@/lib/round'
import { calcGrandTotal } from '@/lib/utils'
import mongoose from 'mongoose'

/** Reuse existing line's FIFO breakdown when stock wasn't restored (rate-only edit). Re-apply consumption and create item. */
async function reuseExistingBreakdown(
  existingItems: { product?: unknown; indiaProduct?: unknown; productSource?: string; pcsSold?: number; fifoBreakdown?: unknown[]; fifoNote?: string }[],
  row: { productId: string; productSource: string; ratePerPcs: number },
  pcsToSell: number
): Promise<{ fifoBreakdown: { buyingEntry?: mongoose.Types.ObjectId; indiaBuyingEntry?: mongoose.Types.ObjectId; ctnConsumed: number; pcsConsumed: number; finalCost: number; profit: number }[]; fifoNote?: string; totalProfit: number; pcsSold: number; ctnSold: number } | null> {
  const productIdStr = row.productId
  const isIndia = row.productSource === 'india'
  const existing = existingItems.find((i) => {
    const key = (i.product ?? i.indiaProduct)?.toString?.()
    return key === productIdStr && (i.pcsSold ?? 0) === pcsToSell
  })
  if (!existing?.fifoBreakdown?.length) return null
  const breakdown = existing.fifoBreakdown as { buyingEntry?: unknown; indiaBuyingEntry?: unknown; ctnConsumed?: number; pcsConsumed?: number; finalCost?: number; profit?: number }[]
  if (isIndia) {
    await applyIndiaFIFO(breakdown as Parameters<typeof applyIndiaFIFO>[0])
  } else {
    await applyFIFO(breakdown as Parameters<typeof applyFIFO>[0])
  }
  const ctnSold = breakdown.reduce((s, b) => s + (b.ctnConsumed ?? 0), 0)
  const totalProfit = round(breakdown.reduce((s, b) => s + (row.ratePerPcs - (b.finalCost ?? 0)) * (b.pcsConsumed ?? 0), 0))
  const fifoBreakdown = breakdown.map((b) => ({
    buyingEntry: b.buyingEntry as mongoose.Types.ObjectId | undefined,
    indiaBuyingEntry: b.indiaBuyingEntry as mongoose.Types.ObjectId | undefined,
    ctnConsumed: b.ctnConsumed ?? 0,
    pcsConsumed: b.pcsConsumed ?? 0,
    finalCost: b.finalCost ?? 0,
    profit: round((row.ratePerPcs - (b.finalCost ?? 0)) * (b.pcsConsumed ?? 0)),
  }))
  return { fifoBreakdown, fifoNote: existing.fifoNote, totalProfit, pcsSold: pcsToSell, ctnSold }
}

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
        { success: false, error: 'Validation failed', message: 'Invalid bill id' },
        { status: 400 }
      )
    }

    await connectDB()

    const bill = await SellBill.findById(id)
      .lean()
      .populate('company')
      .populate({
        path: 'items',
        populate: [
          { path: 'product', select: 'productName' },
          { path: 'indiaProduct', select: 'productName' },
          { path: 'fifoBreakdown.buyingEntry', select: 'entryDate' },
        ],
      })

    if (!bill) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Sell bill not found' },
        { status: 404 }
      )
    }

    const totalProfit = (bill.items as { totalProfit?: number }[]).reduce((s, i) => s + (i.totalProfit ?? 0), 0)
    return NextResponse.json({
      success: true,
      data: { ...bill, totalProfit },
    })
  } catch (error) {
    console.error('Sell bill get API Error:', error)
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

const itemSchema = {
  productSource: (v: unknown) => v === 'china' || v === 'india',
  productId: (v: unknown) => v != null && typeof v === 'string' && mongoose.Types.ObjectId.isValid(v),
  ratePerPcs: (v: unknown) => typeof v === 'number' && v >= 0,
}

/** Resolve PCS from row (handles pcs, pieces, quantity, or ctn * qtyPerCtn). */
function resolvePcs(row: { pcs?: number; pieces?: number; quantity?: number; ctn?: number; qtyPerCtn?: number }): number {
  const pcs = row.pcs ?? row.pieces ?? row.quantity ?? Math.round((row.ctn ?? 0) * (row.qtyPerCtn ?? 1))
  return typeof pcs === 'number' && !Number.isNaN(pcs) ? Math.max(0, Math.round(pcs)) : 0
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
        { success: false, error: 'Validation failed', message: 'Invalid bill id' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const companyId = body.companyId
    const billDate = body.billDate
    const items: { productSource: 'china' | 'india'; productId: string; pcs: number; ratePerPcs: number }[] = Array.isArray(body.items) ? body.items : []
    const notes = body.notes
    const extraCharges = Number(body.extraCharges) || 0
    const extraChargesNote = body.extraChargesNote != null ? String(body.extraChargesNote).trim() : ''
    const discount = Number(body.discount) || 0
    const discountNote = body.discountNote != null ? String(body.discountNote).trim() : ''

    const isCashbook = companyId === 'cashbook'
    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Select company or Cashbook' },
        { status: 400 }
      )
    }
    if (!isCashbook && !mongoose.Types.ObjectId.isValid(companyId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid company is required' },
        { status: 400 }
      )
    }
    if (!billDate) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Bill date is required' },
        { status: 400 }
      )
    }
    if (
      !items.length ||
      items.some(
        (i: {
          productSource?: unknown
          productId?: unknown
          pcs?: number
          pieces?: number
          quantity?: number
          ctn?: number
          qtyPerCtn?: number
          ratePerPcs?: unknown
        }) =>
          !itemSchema.productSource(i.productSource) ||
          !itemSchema.productId(i.productId) ||
          resolvePcs(i) <= 0 ||
          !itemSchema.ratePerPcs(i.ratePerPcs)
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'At least one valid line item (source, product, PCS/quantity > 0, rate) is required',
        },
        { status: 400 }
      )
    }

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    // Check how items are stored — find SellBillItem with explicit bill id
    const billIdObj = new mongoose.Types.ObjectId(id)
    const rawItems = await SellBillItem.find({ sellBill: billIdObj }).lean()

    const bill = await SellBill.findById(id).populate('items')
    if (!bill) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Sell bill not found' },
        { status: 404 }
      )
    }

    const existingIsCashbook = (bill as { isCashbook?: boolean }).isCashbook === true
    const oldGrandTotal =
      (bill as { grandTotal?: number }).grandTotal ??
      (bill as { totalAmount?: number }).totalAmount ??
      0
    const existingCompanyId = (bill as { company?: mongoose.Types.ObjectId }).company

    // Cannot switch cashbook ↔ company on edit
    if (existingIsCashbook && companyId !== 'cashbook') {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Cashbook bills cannot be changed to company bills' },
        { status: 400 }
      )
    }
    if (!existingIsCashbook && companyId === 'cashbook') {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Company bills cannot be changed to Cashbook' },
        { status: 400 }
      )
    }

    // Step 1 — Restore stock from existing bill items FIRST (reversal before any re-run).
    // Use atomic $inc so restoration is guaranteed; no read-modify-save race.
    const existingItems = await SellBillItem.find({ sellBill: billIdObj }).lean()
    for (const item of existingItems) {
      const breakdown = (item.fifoBreakdown ?? []) as Record<string, unknown>[]
      const isIndia = (item.productSource as string) === 'india'
      for (const fb of breakdown) {
        const entryIdRaw = isIndia
          ? fb.indiaBuyingEntry ?? (fb as Record<string, unknown>).indiaBuyingEntryId ?? fb.entryId ?? fb.entry
          : fb.buyingEntry ?? fb.buyingEntryId ?? fb.entryId ?? fb.entry
        const entryId =
          entryIdRaw != null && typeof entryIdRaw === 'object' && '_id' in entryIdRaw
            ? (entryIdRaw as { _id: mongoose.Types.ObjectId })._id
            : entryIdRaw
        if (entryId == null || !mongoose.Types.ObjectId.isValid(entryId as string)) {
          continue
        }
        const eid = typeof entryId === 'string' ? new mongoose.Types.ObjectId(entryId) : (entryId as mongoose.Types.ObjectId)
        const ctnConsumed = Number(fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0)
        if (ctnConsumed <= 0) continue
        if (isIndia) {
          await IndiaBuyingEntry.findByIdAndUpdate(eid, {
            $inc: { availableCtn: ctnConsumed },
          })
        } else {
          await BuyingEntry.findByIdAndUpdate(eid, {
            $inc: { soldCtn: -ctnConsumed, availableCtn: ctnConsumed },
          })
        }
      }
    }
    // Pcs already on this bill (per product) — for FIFO availability check exclusion. Compute before delete.
    const pcsAlreadyOnThisBillByProduct = new Map<string, number>()
    for (const item of existingItems) {
      const key = ((item as { product?: mongoose.Types.ObjectId; indiaProduct?: mongoose.Types.ObjectId }).product ??
        (item as { indiaProduct?: mongoose.Types.ObjectId }).indiaProduct)?.toString()
      if (key) {
        const prev = pcsAlreadyOnThisBillByProduct.get(key) ?? 0
        pcsAlreadyOnThisBillByProduct.set(key, prev + ((item as { pcsSold?: number }).pcsSold ?? 0))
      }
    }

    await SellBillItem.deleteMany({ sellBill: billIdObj })

    // Step 2 — Process new items with FIFO. On any failure, rollback: reverse new items and re-apply original.
    const createdItems: mongoose.Types.ObjectId[] = []
    const createdBreakdowns: { fifoBreakdown: { buyingEntry?: mongoose.Types.ObjectId; indiaBuyingEntry?: mongoose.Types.ObjectId; ctnConsumed: number }[] }[] = []
    let totalAmount = 0

    try {
      for (const row of items) {
        const pcsToSell = resolvePcs(row)
        if (!pcsToSell || pcsToSell <= 0) {
          throw new Error(`Invalid quantity for product ${row.productId}: PCS must be > 0 (got pcs/pieces/quantity/ctn*qtyPerCtn = ${pcsToSell})`)
        }
        const productId = new mongoose.Types.ObjectId(row.productId)
        const isIndia = row.productSource === 'india'
        const pcsOnBill = pcsAlreadyOnThisBillByProduct.get(row.productId) ?? 0
        let fifoBreakdown: { buyingEntry?: mongoose.Types.ObjectId; indiaBuyingEntry?: mongoose.Types.ObjectId; ctnConsumed: number; pcsConsumed?: number; finalCost?: number; profit?: number }[]
        let fifoNote: string | undefined
        let totalProfit: number
        let pcsSold: number
        let ctnSold: number
        try {
          const result = isIndia
            ? await processIndiaFIFO(productId, pcsToSell, row.ratePerPcs, pcsOnBill)
            : await processFIFO(productId, pcsToSell, row.ratePerPcs, pcsOnBill)
          fifoBreakdown = result.fifoBreakdown
          fifoNote = result.fifoNote
          totalProfit = result.totalProfit
          pcsSold = result.pcsSold
          ctnSold = result.fifoBreakdown.reduce((s, b) => s + b.ctnConsumed, 0)
        } catch (fifoErr) {
          const msg = fifoErr instanceof Error ? fifoErr.message : ''
          if (pcsOnBill >= pcsToSell && msg.includes('on this bill')) {
            const reused = await reuseExistingBreakdown(existingItems, row, pcsToSell)
            if (reused) {
              fifoBreakdown = reused.fifoBreakdown
              fifoNote = reused.fifoNote
              totalProfit = reused.totalProfit
              pcsSold = reused.pcsSold
              ctnSold = reused.ctnSold
            } else {
              throw fifoErr
            }
          } else {
            throw fifoErr
          }
        }
        const lineTotal = pcsSold * row.ratePerPcs
        totalAmount += lineTotal

        const item = await SellBillItem.create({
          sellBill: new mongoose.Types.ObjectId(id),
          productSource: row.productSource,
          product: isIndia ? undefined : productId,
          indiaProduct: isIndia ? productId : undefined,
          ctnSold: parseFloat(ctnSold.toFixed(4)),
          pcsSold,
          ratePerPcs: row.ratePerPcs,
          totalAmount: lineTotal,
          fifoBreakdown,
          fifoNote,
          totalProfit,
          createdBy: (bill as { createdBy?: mongoose.Types.ObjectId }).createdBy ?? updatedBy,
          updatedBy,
        })
        createdItems.push(item._id as mongoose.Types.ObjectId)
        createdBreakdowns.push({ fifoBreakdown })
      }
    } catch (fifoError) {
      // Rollback: reverse new item consumption, delete new items, re-apply original consumption, restore original items.
      for (const { fifoBreakdown } of createdBreakdowns) {
        await reverseFIFO(fifoBreakdown)
        await reverseIndiaFIFO(fifoBreakdown)
      }
      if (createdItems.length > 0) {
        await SellBillItem.deleteMany({ _id: { $in: createdItems } })
      }
      for (const item of existingItems) {
        await applyFIFO(item.fifoBreakdown ?? [])
        await applyIndiaFIFO(item.fifoBreakdown ?? [])
      }
      const restored = await SellBillItem.insertMany(
        existingItems.map((i) => ({
          sellBill: new mongoose.Types.ObjectId(id),
          productSource: i.productSource,
          product: i.product,
          indiaProduct: i.indiaProduct,
          ctnSold: i.ctnSold,
          pcsSold: i.pcsSold,
          ratePerPcs: i.ratePerPcs,
          totalAmount: i.totalAmount,
          fifoBreakdown: i.fifoBreakdown ?? [],
          fifoNote: i.fifoNote,
          totalProfit: i.totalProfit ?? 0,
          createdBy: (bill as { createdBy?: mongoose.Types.ObjectId }).createdBy ?? updatedBy,
          updatedBy,
        }))
      )
      ;(bill as { items: mongoose.Types.ObjectId[] }).items = restored.map((r) => r._id as mongoose.Types.ObjectId)
      await bill.save()
      const message = fifoError instanceof Error ? fifoError.message : 'Insufficient stock'
      return NextResponse.json(
        { success: false, error: 'Validation failed', message },
        { status: 400 }
      )
    }

    const newSubtotal = Math.round(totalAmount * 100) / 100
    const newGrandTotal = calcGrandTotal(newSubtotal, extraCharges, discount)
    const amountDiff = newGrandTotal - oldGrandTotal

    // Step 3 — Adjust cash or company outstanding by the grand total difference
    if (amountDiff !== 0) {
      if (existingIsCashbook) {
        await createCashTransaction({
          type: amountDiff > 0 ? 'credit' : 'debit',
          amount: Math.abs(amountDiff),
          description: `Cashbook bill edited — adjustment for Bill #${(bill as { billNumber?: number }).billNumber ?? id}`,
          date: billDate ? new Date(billDate) : new Date(),
          category: 'cashbook_sale_edit',
          referenceId: new mongoose.Types.ObjectId(id),
          referenceType: 'SellBill',
          sortOrder: 1,
        })
      } else if (existingCompanyId) {
        await Company.findByIdAndUpdate(existingCompanyId, {
          $inc: { outstanding: amountDiff },
        })
      }
    }

    ;(bill as { company: mongoose.Types.ObjectId | null; isCashbook: boolean; companyName: string | null }).company = isCashbook ? null : new mongoose.Types.ObjectId(companyId)
    ;(bill as { isCashbook: boolean }).isCashbook = !!isCashbook
    ;(bill as { companyName: string | null }).companyName = isCashbook ? 'Cashbook' : null
    bill.billDate = new Date(billDate)
    bill.items = createdItems
    bill.totalAmount = newSubtotal
    ;(bill as { extraCharges?: number }).extraCharges = extraCharges
    ;(bill as { extraChargesNote?: string }).extraChargesNote = extraChargesNote || undefined
    ;(bill as { discount?: number }).discount = discount
    ;(bill as { discountNote?: string }).discountNote = discountNote || undefined
    ;(bill as { grandTotal?: number }).grandTotal = newGrandTotal
    bill.notes = notes != null && String(notes).trim() !== '' ? String(notes).trim() : undefined
    bill.updatedBy = updatedBy
    await bill.save()

    const populated = await SellBill.findById(id)
      .lean()
      .populate('company', 'companyName ownerName contact1Mobile contact2Mobile primaryMobile address city openingBalance')
      .populate({ path: 'items', populate: { path: 'product', select: 'productName' } })

    return NextResponse.json({ success: true, data: populated })
  } catch (error) {
    console.error('Sell bill update API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error && error.message.includes('Insufficient stock') ? 'Validation failed' : 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: error instanceof Error && error.message.includes('Insufficient stock') ? 400 : 500 }
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
        { success: false, error: 'Validation failed', message: 'Invalid bill id' },
        { status: 400 }
      )
    }

    await connectDB()

    const bill = await SellBill.findById(id).lean()
    if (!bill) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Sell bill not found' },
        { status: 404 }
      )
    }

    const items = await SellBillItem.find({ sellBill: id }).lean()
    for (const item of items) {
      await reverseFIFO(item.fifoBreakdown ?? [])
      await reverseIndiaFIFO(item.fifoBreakdown ?? [])
    }
    await SellBillItem.deleteMany({ sellBill: id })

    const isCashbook = (bill as { isCashbook?: boolean }).isCashbook === true
    const amountToReverse =
      (bill as { grandTotal?: number }).grandTotal ??
      (bill as { totalAmount?: number }).totalAmount ??
      0
    if (isCashbook) {
      if (amountToReverse > 0) {
        const billIdObj = new mongoose.Types.ObjectId(id)
        const originalCashTx = await CashTransaction.findOne({
          referenceId: billIdObj,
          referenceType: 'SellBill',
          isReversal: { $ne: true },
        })
          .sort({ createdAt: 1 })
          .lean()
        const originalDate = originalCashTx ? (originalCashTx as { date?: Date }).date : (bill as { billDate?: Date }).billDate
        await createCashTransaction({
          type: 'debit',
          amount: amountToReverse,
          description: `Reversal — Cashbook bill deleted #${(bill as { billNumber?: number }).billNumber ?? id}`,
          date: originalDate ? new Date(originalDate) : new Date(),
          category: 'reversal',
          referenceId: billIdObj,
          referenceType: 'SellBill',
          isReversal: true,
          reversalOf: originalCashTx?._id ?? null,
          sortOrder: 1,
        })
      }
    } else {
      const companyId = (bill as { company?: mongoose.Types.ObjectId }).company
      if (companyId && amountToReverse > 0) {
        await Company.findByIdAndUpdate(companyId, {
          $inc: { outstanding: -amountToReverse },
        })
      }
    }

    await SellBill.findByIdAndDelete(id)

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Sell bill delete API Error:', error)
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
