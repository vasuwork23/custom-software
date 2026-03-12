import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import SellBillItem from '@/models/SellBillItem'

export const dynamic = 'force-dynamic'

/**
 * POST /api/fix/sync-sold-ctn
 * Reads actual FIFO data from SellBillItems and syncs soldCtn + availableCtn for ALL BuyingEntries.
 * Logs sample fifoBreakdown structure. Returns before/after per entry.
 * Owner-only.
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
        { success: false, error: 'Forbidden', message: 'Only Owner can run sync sold CTN' },
        { status: 403 }
      )
    }

    await connectDB()

    const sampleItem = await SellBillItem.findOne({
      fifoBreakdown: { $exists: true, $ne: [] },
    })
    if (sampleItem) {
    }

    const allSellItems = await SellBillItem.find({
      fifoBreakdown: { $exists: true, $ne: [] },
    }).lean()

    const entries = await BuyingEntry.find({}).exec()
    const results: {
      mark: string
      totalCtn: number
      soldCtn_before: number
      soldCtn_after: number
      availableCtn_after: number
      matchingItems: number
    }[] = []

    for (const entry of entries) {
      let actualSoldCtn = 0
      let matchingItems = 0
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
          matchingItems += 1
          actualSoldCtn += Number(
            fb.ctnConsumed ?? fb.ctns ?? fb.ctn ?? fb.quantity ?? 0
          )
        }
      }

      const totalCtn = entry.totalCtn ?? 0
      const chinaCtn = entry.chinaWarehouseCtn ?? 0
      const transitCtn = entry.inTransitCtn ?? 0
      const correctAvailableCtn = Math.max(
        0,
        totalCtn - chinaCtn - transitCtn - actualSoldCtn
      )

      const soldCtnBefore = entry.soldCtn ?? 0
      await BuyingEntry.findByIdAndUpdate(entry._id, {
        soldCtn: actualSoldCtn,
        availableCtn: correctAvailableCtn,
      })

      results.push({
        mark: entry.mark ?? String(entry._id),
        totalCtn,
        soldCtn_before: soldCtnBefore,
        soldCtn_after: actualSoldCtn,
        availableCtn_after: correctAvailableCtn,
        matchingItems,
      })

        `Entry ${entry.mark ?? entry._id}: soldCtn ${soldCtnBefore} → ${actualSoldCtn}, availableCtn → ${correctAvailableCtn}, matchingItems=${matchingItems}`
      )
    }

    return NextResponse.json({
      success: true,
      data: { processed: entries.length, results },
      message: `Synced soldCtn for ${entries.length} buying entries from FIFO records.`,
    })
  } catch (error) {
    console.error('Sync sold CTN API Error:', error)
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
