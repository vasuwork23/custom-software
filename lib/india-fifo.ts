import mongoose from 'mongoose'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import type { IFifoBreakdownItem } from '@/models/SellBillItem'
import { round, roundCtn } from '@/lib/round'

export interface ProcessIndiaFIFOResult {
  fifoBreakdown: IFifoBreakdownItem[]
  fifoNote?: string
  totalProfit: number
  pcsSold: number
}

/**
 * Process FIFO for India product: consume PCS from oldest IndiaBuyingEntry,
 * build breakdown with indiaBuyingEntry ref, deduct availableCtn (decimal ok).
 * CTN consumed per entry can be decimal (pcsConsumed / entry.qty).
 * When pcsAlreadyOnThisBill is set (edit flow), those pcs count as available so the check passes.
 */
export async function processIndiaFIFO(
  indiaProductId: mongoose.Types.ObjectId,
  pcsToSell: number,
  ratePerPcs: number,
  pcsAlreadyOnThisBill: number = 0
): Promise<ProcessIndiaFIFOResult> {
  const entries = await IndiaBuyingEntry.find({
    product: indiaProductId,
    availableCtn: { $gt: 0 },
  })
    .sort({ createdAt: 1 })
    .lean()

  const totalAvailablePcs = entries.reduce((s, e) => s + e.availableCtn * e.qty, 0)
  const effectiveAvailable = totalAvailablePcs + pcsAlreadyOnThisBill
  if (Math.round(pcsToSell) > Math.round(effectiveAvailable)) {
    const totalAvailableCtn = entries.reduce((s, e) => s + e.availableCtn, 0)
    throw new Error(
      `Insufficient stock. Only ${Math.round(effectiveAvailable)} pcs available (${Math.round(totalAvailablePcs)} in stock + ${pcsAlreadyOnThisBill} on this bill) for this India product.`
    )
  }

  let remainingPcsToSell = pcsToSell
  const fifoBreakdown: IFifoBreakdownItem[] = []
  const fifoNotes: string[] = []
  let totalProfit = 0
  let pcsSold = 0

  for (const entry of entries) {
    if (remainingPcsToSell <= 0) break

    const availablePcsThisEntry = entry.availableCtn * entry.qty
    // Pcs are always whole units; rounding eliminates float residuals from availableCtn × qty
    const pcsFromThisEntry = Math.round(Math.min(remainingPcsToSell, availablePcsThisEntry))
    // When consuming all remaining pcs from this entry, snap to avoid float division residuals
    const isFullyConsuming = pcsFromThisEntry >= availablePcsThisEntry
    const ctnFromThisEntry = isFullyConsuming
      ? entry.availableCtn // exact stored value, no division
      : pcsFromThisEntry / entry.qty
    const finalCost = entry.finalCost ?? entry.rate ?? 0
    const profitFromThisEntry = (ratePerPcs - finalCost) * pcsFromThisEntry

    const profitRounded = round(profitFromThisEntry)
    const ctnConsumed = roundCtn(ctnFromThisEntry)
    fifoBreakdown.push({
      indiaBuyingEntry: entry._id as mongoose.Types.ObjectId,
      ctnConsumed,
      pcsConsumed: pcsFromThisEntry,
      finalCost,
      profit: profitRounded,
    })
    totalProfit += profitRounded
    pcsSold += pcsFromThisEntry

    const entryDateStr = entry.entryDate
      ? new Date(entry.entryDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A'
    const ctnDisplay = Number.isInteger(ctnFromThisEntry) ? ctnFromThisEntry : roundCtn(ctnFromThisEntry)
    fifoNotes.push(`${ctnDisplay} CTN from batch dated ${entryDateStr}`)

    const doc = await IndiaBuyingEntry.findById(entry._id)
    if (doc) {
      // When fully consuming an entry, snap availableCtn to exactly 0 (prevents tiny float residuals)
      doc.availableCtn = isFullyConsuming ? 0 : roundCtn((doc.availableCtn ?? 0) - ctnConsumed)
      await doc.save()
    }
    remainingPcsToSell -= pcsFromThisEntry
  }

  if (remainingPcsToSell > 0) {
    await reverseIndiaFIFO(fifoBreakdown)
    const totalAvailableCtn = entries.reduce((s, e) => s + e.availableCtn, 0)
    throw new Error(
      `Insufficient stock. Only ${Math.round(effectiveAvailable)} pcs available (${Math.round(totalAvailablePcs)} in stock + ${pcsAlreadyOnThisBill} on this bill) for this India product.`
    )
  }

  const fifoNote =
    fifoBreakdown.length > 1 ? `Stock taken from: ${fifoNotes.join(' + ')}` : undefined

  return {
    fifoBreakdown,
    fifoNote,
    totalProfit: round(totalProfit),
    pcsSold: Math.round(pcsSold),
  }
}

/** Resolve IndiaBuyingEntry id from a breakdown item (handles field name variations and populated refs). */
function resolveIndiaEntryId(item: IFifoBreakdownItem & Record<string, unknown>): mongoose.Types.ObjectId | null {
  const raw =
    item.indiaBuyingEntry != null
      ? (typeof item.indiaBuyingEntry === 'object' &&
        item.indiaBuyingEntry !== null &&
        '_id' in item.indiaBuyingEntry
        ? (item.indiaBuyingEntry as { _id: mongoose.Types.ObjectId })._id
        : item.indiaBuyingEntry)
      : (item as Record<string, unknown>).indiaBuyingEntryId ??
        (item as Record<string, unknown>).entryId ??
        (item as Record<string, unknown>).entry
  if (raw == null) return null
  const id = typeof raw === 'string' ? raw : (raw as mongoose.Types.ObjectId)
  return mongoose.Types.ObjectId.isValid(id) ? (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id) : null
}

/** Resolve ctn consumed from a breakdown item (handles field name variations). */
function resolveCtnConsumed(item: IFifoBreakdownItem & Record<string, unknown>): number {
  const n = item.ctnConsumed ?? (item as Record<string, unknown>).ctns ?? (item as Record<string, unknown>).ctn ?? (item as Record<string, unknown>).quantity ?? 0
  return typeof n === 'number' && !Number.isNaN(n) ? n : 0
}

/**
 * Reverse India FIFO: restore availableCtn to all IndiaBuyingEntries in the breakdown.
 * Handles field name variations: indiaBuyingEntryId, entryId, entry; ctnConsumed, ctns, ctn, quantity.
 */
export async function reverseIndiaFIFO(fifoBreakdown: IFifoBreakdownItem[]): Promise<void> {
  for (const item of fifoBreakdown) {
    const entryId = resolveIndiaEntryId(item as IFifoBreakdownItem & Record<string, unknown>)
    const ctnConsumed = resolveCtnConsumed(item as IFifoBreakdownItem & Record<string, unknown>)
    if (!entryId || ctnConsumed <= 0) continue
    const entry = await IndiaBuyingEntry.findById(entryId)
    if (entry) {
      entry.availableCtn = roundCtn((entry.availableCtn ?? 0) + ctnConsumed)
      await entry.save()
    }
  }
}

/**
 * Re-apply India FIFO consumption (inverse of reverseIndiaFIFO). Used when rolling back a failed edit.
 */
export async function applyIndiaFIFO(fifoBreakdown: IFifoBreakdownItem[]): Promise<void> {
  for (const item of fifoBreakdown) {
    const entryId = resolveIndiaEntryId(item as IFifoBreakdownItem & Record<string, unknown>)
    const ctnConsumed = resolveCtnConsumed(item as IFifoBreakdownItem & Record<string, unknown>)
    if (!entryId || ctnConsumed <= 0) continue
    const entry = await IndiaBuyingEntry.findById(entryId)
    if (entry) {
      entry.availableCtn = roundCtn(Math.max(0, (entry.availableCtn ?? 0) - ctnConsumed))
      await entry.save()
    }
  }
}
