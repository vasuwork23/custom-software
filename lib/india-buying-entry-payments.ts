import mongoose from 'mongoose'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/**
 * Recalculate givenAmount = advanceAmount + sum(IndiaBuyingPayments) for an India entry,
 * then remainingAmount and currentStatus. Saves the entry.
 */
export async function recalcIndiaBuyingEntryGivenAndStatus(
  entryId: mongoose.Types.ObjectId
): Promise<void> {
  const entry = await IndiaBuyingEntry.findById(entryId)
  if (!entry) return
  const paymentsSum = await IndiaBuyingPayment.aggregate([
    { $match: { buyingEntry: entryId } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const sumPayments = paymentsSum[0]?.total ?? 0
  const advance = entry.hasAdvancePayment ? (entry.advanceAmount ?? 0) : 0
  entry.givenAmount = round2(advance + sumPayments)
  entry.remainingAmount = round2(entry.totalAmount - entry.givenAmount)
  if (entry.totalAmount === 0) entry.currentStatus = 'unpaid'
  else if (entry.remainingAmount <= 0) entry.currentStatus = 'paid'
  else if (entry.givenAmount === 0) entry.currentStatus = 'unpaid'
  else entry.currentStatus = 'partiallypaid'
  await entry.save()
}
