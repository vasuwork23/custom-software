import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import SellBillItem from '@/models/SellBillItem'

export const dynamic = 'force-dynamic'

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
        { success: false, error: 'Forbidden', message: 'Only Owner can run sold CTN recalculation' },
        { status: 403 }
      )
    }

    await connectDB()

    const entries = await BuyingEntry.find({}).exec()
    let processed = 0

    // Get ALL sell bill items that have any fifoBreakdown (don't filter by entry in query)
    const allSellItems = await SellBillItem.find({
      fifoBreakdown: { $exists: true, $ne: [] },
    }).lean()

    for (const entry of entries) {
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
          if (fbEntryId !== entryIdStr) continue

          const ctn = Number(
            fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0
          )
          actualSoldCtn += ctn
        }
      }

      const totalCtn = entry.totalCtn ?? 0
      const chinaCtn = entry.chinaWarehouseCtn ?? 0
      const transitCtn = entry.inTransitCtn ?? 0

      const availableCtn = parseFloat(
        Math.max(0, totalCtn - chinaCtn - transitCtn - actualSoldCtn).toFixed(2)
      )
      const soldCtnRounded = parseFloat(actualSoldCtn.toFixed(2))

      const oldSoldCtn = entry.soldCtn ?? 0
      if (actualSoldCtn !== oldSoldCtn || processed < 5) {
          `[recalculate-sold-ctn] Entry ${entry.mark ?? entry._id}: totalCtn=${totalCtn} actualSoldCtn=${soldCtnRounded} availableCtn=${availableCtn} OLD soldCtn=${oldSoldCtn}`
        )
      }

      await BuyingEntry.findByIdAndUpdate(entry._id, {
        soldCtn: soldCtnRounded,
        availableCtn,
      })

      processed += 1
    }

    return NextResponse.json({
      success: true,
      data: { processed },
      message: 'soldCtn recalculated from actual FIFO records for all BuyingEntry documents',
    })
  } catch (error) {
    console.error('Fix recalculate sold CTN API Error:', error)
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

