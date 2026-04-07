import mongoose, { Schema, model, models } from 'mongoose'
import { round, roundQty } from '@/lib/round'
export interface IBuyingEntry {
  _id?: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  mark: string
  totalCtn: number
  qty: number
  rate: number // RMB ¥ per piece
  cbm: number
  weight: number
  givenAmount: number // RMB ¥ — auto: advanceAmount + sum(BuyingPayments)
  hasAdvancePayment: boolean
  advanceAmount?: number // RMB ¥
  advanceChinaPerson?: mongoose.Types.ObjectId // ref: ChinaPerson (for advance)
  advanceDate?: Date
  advanceNote?: string
  carryingRate?: number // INR per CBM
  avgRmbRate?: number // RMB→INR rate
  totalQty: number
  totalCbm: number
  totalWeight: number
  totalAmount: number // RMB ¥ (totalQty * rate)
  remainingAmount: number // RMB ¥ (totalAmount - givenAmount)
  totalCarrying: number // INR (totalCbm * carryingRate)
  totalExpenseINR: number // INR (rmbInrPurchase + totalCarrying)
  shippingCostPerPiece: number // INR per piece (totalCarrying / totalQty)
  perPisShipping: number // deprecated, kept for compat
  rmbInrPurchase: number // INR (totalAmount * avgRmbRate) full batch
  finalCost: number // INR per piece (totalExpenseINR / totalQty)
  currentStatus: 'paid' | 'unpaid' | 'partiallypaid'
  chinaWarehouseReceived: 'yes' | 'no'
  chinaWarehouseCtn: number
  inTransitCtn: number
  soldCtn: number
  isLocked: boolean
  lockedAt?: Date
  lockedCtn?: number
  lockedAmount?: number
  availableCtn: number
  entryDate: Date
  containerId?: mongoose.Types.ObjectId | null // ref: Container — null if not assigned
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BuyingEntrySchema = new Schema<IBuyingEntry>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    mark: { type: String, required: true, trim: true },
    totalCtn: { type: Number, required: true },
    qty: { type: Number, required: true },
    rate: { type: Number, required: true },
    cbm: { type: Number, required: true },
    weight: { type: Number, required: true },
    givenAmount: { type: Number, default: 0 },
    hasAdvancePayment: { type: Boolean, default: false },
    advanceAmount: { type: Number },
    advanceChinaPerson: { type: Schema.Types.ObjectId, ref: 'ChinaPerson' },
    advanceDate: { type: Date },
    advanceNote: { type: String },
    carryingRate: { type: Number },
    avgRmbRate: { type: Number },
    totalQty: { type: Number, required: true },
    totalCbm: { type: Number, required: true },
    totalWeight: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    remainingAmount: { type: Number, required: true },
    totalCarrying: { type: Number, default: 0 },
    totalExpenseINR: { type: Number, default: 0 },
    shippingCostPerPiece: { type: Number, default: 0 },
    perPisShipping: { type: Number, default: 0 },
    rmbInrPurchase: { type: Number, default: 0 },
    finalCost: { type: Number, default: 0 },
    currentStatus: {
      type: String,
      enum: ['paid', 'unpaid', 'partiallypaid'],
      default: 'unpaid',
    },
    chinaWarehouseReceived: {
      type: String,
      enum: ['yes', 'no'],
      default: 'no',
      required: true,
    },
    chinaWarehouseCtn: { type: Number, default: 0 },
    inTransitCtn: { type: Number, default: 0 },
    soldCtn: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date },
    lockedCtn: { type: Number, default: 0 },
    lockedAmount: { type: Number, default: 0 },
    availableCtn: { type: Number, required: true },
    entryDate: { type: Date, required: true },
    containerId: { type: Schema.Types.ObjectId, ref: 'Container', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

BuyingEntrySchema.pre('save', function (next) {
  const doc = this as IBuyingEntry

  const totalCtn = doc.totalCtn ?? 0
  const qtyPerCtn = doc.qty ?? 0
  const ratePerPiece = doc.rate ?? 0
  const cbmPerCtn = doc.cbm ?? 0
  const weightPerCtn = doc.weight ?? 0
  const carryingRate = doc.carryingRate ?? 0
  const avgRmbRate = doc.avgRmbRate ?? 0
  const givenAmount = doc.givenAmount ?? 0

  // Raw calculations (no rounding)
  const totalQtyRaw = totalCtn * qtyPerCtn
  const totalCbmRaw = totalCtn * cbmPerCtn
  const totalWeightRaw = totalCtn * weightPerCtn
  const totalAmountRaw = totalQtyRaw * ratePerPiece // RMB
  const rmbInrPurchaseRaw = totalAmountRaw * avgRmbRate // INR
  const totalCarryingRaw = totalCbmRaw * carryingRate // INR
  const totalExpenseRaw = rmbInrPurchaseRaw + totalCarryingRaw // INR

  // Store rounded values
  doc.totalQty = roundQty(totalQtyRaw)
  doc.totalCbm = round(totalCbmRaw)
  doc.totalWeight = round(totalWeightRaw)
  doc.totalAmount = Math.round(totalAmountRaw) // RMB - Round to integer like India
  doc.rmbInrPurchase = round(rmbInrPurchaseRaw) // INR
  doc.totalCarrying = round(totalCarryingRaw) // INR
  doc.totalExpenseINR = round(totalExpenseRaw)

  const roundedTotalAmount = doc.totalAmount
  const roundedGivenAmount = doc.givenAmount ?? 0
  doc.remainingAmount = Number((roundedTotalAmount - roundedGivenAmount).toFixed(2))

  // Final per-piece costs use RAW totals, then rounded once
  doc.finalCost =
    doc.totalQty > 0 ? round(totalExpenseRaw / doc.totalQty) : 0
  doc.shippingCostPerPiece =
    doc.totalQty > 0 ? round(totalCarryingRaw / doc.totalQty) : 0
  doc.perPisShipping =
    doc.totalQty > 0 ? round(totalCarryingRaw / doc.totalQty) : 0 // legacy
  // Ensure warehouse split fields are consistent defaults
  if (!doc.chinaWarehouseReceived) {
    doc.chinaWarehouseReceived = 'no'
  }
  if (doc.chinaWarehouseReceived === 'no') {
    // All stock is either in China or in transit; India availableCtn managed directly in APIs/FIFO
    if (!doc.chinaWarehouseCtn && !doc.inTransitCtn) {
      // Default legacy behavior: all CTN in China until explicitly received / split
      doc.chinaWarehouseCtn = doc.totalCtn
      doc.inTransitCtn = 0
    }
  }
  const given = doc.givenAmount ?? 0
  if (doc.totalAmount === 0) doc.currentStatus = 'unpaid'
  else if (doc.remainingAmount <= 0) doc.currentStatus = 'paid'
  else if (given === 0) doc.currentStatus = 'unpaid'
  else doc.currentStatus = 'partiallypaid'
  next()
})

BuyingEntrySchema.index({ product: 1 })
BuyingEntrySchema.index({ entryDate: -1 })
BuyingEntrySchema.index({ chinaWarehouseReceived: 1, availableCtn: 1 })
BuyingEntrySchema.index({ currentStatus: 1 })
BuyingEntrySchema.index({ product: 1, chinaWarehouseReceived: 1, createdAt: 1 })
BuyingEntrySchema.index({ containerId: 1 })

if (models.BuyingEntry) {
  delete (models as Record<string, mongoose.Model<unknown>>).BuyingEntry
}

const BuyingEntry = model<IBuyingEntry>('BuyingEntry', BuyingEntrySchema)
export default BuyingEntry
