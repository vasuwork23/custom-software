import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import SellBillItem from '@/models/SellBillItem'
import SellBill from '@/models/SellBill'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * GET /api/debug/buying-entry/[id]
 * Inspect FIFO data for a buying entry: entry fields, matching sell items, and actual fifoBreakdown structure.
 * Owner-only. Use to verify why soldCtn might be 0 when CTN were actually sold.
 */
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
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can access debug route' },
        { status: 403 }
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

    const entry = await BuyingEntry.findById(id).lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    // Method 1: Entry fields
    const entrySummary = {
      _id: entry._id,
      totalCtn: entry.totalCtn,
      soldCtn: entry.soldCtn,
      availableCtn: entry.availableCtn,
      chinaWarehouseCtn: entry.chinaWarehouseCtn,
      inTransitCtn: entry.inTransitCtn,
      mark: entry.mark,
    }

    // Method 2: Find SellBillItems whose fifoBreakdown references this entry (any field name)
    const allSellItems = await SellBillItem.find({}).lean()
    const matchingItems: {
      sellBillItemId: unknown
      ctnConsumed: number
      pcsConsumed: number
      buyingEntryRef: unknown
      rawBreakdown: unknown
    }[] = []
    const idStr = String(id)

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
        if (fbEntryId === idStr) {
          const ctn = Number(
            fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0
          )
          const pcs = Number(
            fb.pcsConsumed ?? fb.pcs ?? fb.qtyConsumed ?? fb.quantity ?? 0
          )
          matchingItems.push({
            sellBillItemId: item._id,
            ctnConsumed: ctn,
            pcsConsumed: pcs,
            buyingEntryRef: fb.buyingEntry ?? fb.buyingEntryId ?? fb.entryId ?? fb.entry,
            rawBreakdown: fb,
          })
        }
      }
    }

    const soldCtnFromFifo = matchingItems.reduce((s, i) => s + i.ctnConsumed, 0)

    // Method 3: Bills that contain an item referencing this entry
    const billsWithThisEntry: { billId: unknown; billNumber: number; itemId: unknown }[] = []
    const sellBills = await SellBill.find({}).lean()
    for (const bill of sellBills) {
      const items = await SellBillItem.find({ sellBill: bill._id }).lean()
      for (const item of items) {
        const breakdown = (item.fifoBreakdown ?? []) as Record<string, unknown>[]
        const hasEntry = breakdown.some((fb) => {
          const ref = fb.buyingEntry ?? fb.buyingEntryId ?? fb.entryId ?? fb.entry
          return ref != null && String(ref) === idStr
        })
        if (hasEntry) {
          billsWithThisEntry.push({
            billId: bill._id,
            billNumber: bill.billNumber ?? 0,
            itemId: item._id,
          })
        }
      }
    }

    // Method 4: Sample fifoBreakdown structure from any item (to see actual field names in DB)
    const sampleItem = await SellBillItem.findOne({
      fifoBreakdown: { $exists: true, $ne: [] },
    })
      .lean()
    const sampleFifoStructure = sampleItem?.fifoBreakdown?.[0]
      ? JSON.stringify(sampleItem.fifoBreakdown[0], null, 2)
      : null

    // Method 5: Full SellBillItem document to see REAL field names (ratePerPcs vs sellingPrice, pcsSold vs quantity, etc.)
    const sampleSellBillItemFull = sampleItem
      ? JSON.parse(JSON.stringify(sampleItem)) as Record<string, unknown>
      : null
    if (sampleSellBillItemFull) {
      console.log('SellBillItem full object (for field names):', JSON.stringify(sampleSellBillItemFull, null, 2))
    }

    return NextResponse.json({
      entry: {
        ...entrySummary,
        soldCtnFromFifo,
      },
      fifoMatches: matchingItems,
      billsWithThisEntry,
      sampleFifoStructure: sampleFifoStructure
        ? (JSON.parse(sampleFifoStructure) as Record<string, unknown>)
        : null,
      sampleFifoStructureRaw: sampleFifoStructure,
      sampleSellBillItemFull: sampleSellBillItemFull,
      sampleSellBillItemKeys: sampleSellBillItemFull ? Object.keys(sampleSellBillItemFull) : [],
    })
  } catch (error) {
    console.error('Debug buying entry API Error:', error)
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
