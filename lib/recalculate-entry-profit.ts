import mongoose from 'mongoose'
import BuyingEntry from '@/models/BuyingEntry'
import SellBillItem from '@/models/SellBillItem'
import type { IFifoBreakdownItem } from '@/models/SellBillItem'
import { round } from '@/lib/round'

/**
 * Recalculate profit on all SellBillItems that used this buying entry.
 * - Uses FIFO field fallbacks (buyingEntry, buyingEntryId, entryId, entry; pcsConsumed, qty, quantity).
 * - Updates ONLY fifoBreakdown (finalCost, profit) and totalProfit on each item. Never touches
 *   revenue fields (ratePerPcs, pcsSold, totalAmount) or SellBill.
 * - Skips items where revenue cannot be determined (safety check).
 */
export async function recalculateProfitForEntry(
  buyingEntryId: mongoose.Types.ObjectId
): Promise<void> {
  const entry = await BuyingEntry.findById(buyingEntryId).lean()
  if (!entry) return
  const newFinalCost = entry.finalCost ?? 0

  const allItems = await SellBillItem.find({
    fifoBreakdown: { $exists: true, $ne: [] },
  }).lean()

  const entryIdStr = String(buyingEntryId)

  for (const item of allItems) {
    const breakdown = (item.fifoBreakdown ?? []) as (IFifoBreakdownItem & Record<string, unknown>)[]
    let updated = false

    for (const b of breakdown) {
      const fbEntryId = (
        b.buyingEntry != null ? String(b.buyingEntry) :
        (b as Record<string, unknown>).buyingEntryId != null ? String((b as Record<string, unknown>).buyingEntryId) :
        (b as Record<string, unknown>).entryId != null ? String((b as Record<string, unknown>).entryId) :
        (b as Record<string, unknown>).entry != null ? String((b as Record<string, unknown>).entry) :
        null
      )
      if (fbEntryId !== entryIdStr) continue

      const pcsConsumed = Number(
        b.pcsConsumed ?? (b as Record<string, unknown>).qty ?? (b as Record<string, unknown>).quantity ?? (b as Record<string, unknown>).pieces ?? 0
      )
      b.finalCost = newFinalCost
      b.profit = round((item.ratePerPcs - newFinalCost) * pcsConsumed)
      updated = true
    }

    if (!updated) continue

    // Safety: ensure we have valid revenue so we never overwrite with wrong values
    const ratePerPcs = Number(
      item.ratePerPcs ?? (item as Record<string, unknown>).sellingPrice ?? (item as Record<string, unknown>).salePrice ?? (item as Record<string, unknown>).price ?? 0
    )
    const pcsSold = Number(
      item.pcsSold ?? (item as Record<string, unknown>).quantity ?? (item as Record<string, unknown>).qty ?? (item as Record<string, unknown>).pieces ?? 0
    )
    const revenueFromFields = ratePerPcs > 0 && pcsSold > 0 ? ratePerPcs * pcsSold : 0
    const revenueStored = Number(item.totalAmount ?? 0)
    if (revenueFromFields <= 0 && revenueStored <= 0) {
      console.error(`[recalculateProfitForEntry] SellBillItem ${item._id}: cannot determine revenue (ratePerPcs=${ratePerPcs} pcsSold=${pcsSold} totalAmount=${item.totalAmount}). Skipping.`)
      continue
    }

    const totalProfit = breakdown.reduce((sum, x) => sum + (x.profit ?? 0), 0)
    await SellBillItem.findByIdAndUpdate(item._id, {
      fifoBreakdown: breakdown,
      totalProfit: round(totalProfit),
    })
  }
  // Do NOT update SellBill — totalAmount (revenue) is unchanged; only item-level profit was updated.
}
