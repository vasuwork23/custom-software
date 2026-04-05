import mongoose, { Schema, model, models } from 'mongoose'

export interface IIndiaBuyingEntry {
  _id?: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  totalCtn: number
  qty: number
  rate: number // INR ₹ per piece
  entryDate: Date
  totalQty: number
  totalAmount: number // totalQty * rate (INR)
  finalCost: number // same as rate, per piece INR
  givenAmount: number
  remainingAmount: number
  currentStatus: 'paid' | 'unpaid' | 'partiallypaid'
  hasAdvancePayment: boolean
  advanceAmount?: number
  advanceDate?: Date
  advanceNote?: string
  advanceBankAccount?: mongoose.Types.ObjectId
  availableCtn: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const IndiaBuyingEntrySchema = new Schema<IIndiaBuyingEntry>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'IndiaProduct', required: true },
    totalCtn: { type: Number, required: true },
    qty: { type: Number, required: true },
    rate: { type: Number, required: true },
    entryDate: { type: Date, required: true },
    totalQty: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    finalCost: { type: Number, required: true },
    givenAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, required: true },
    currentStatus: {
      type: String,
      enum: ['paid', 'unpaid', 'partiallypaid'],
      default: 'unpaid',
    },
    hasAdvancePayment: { type: Boolean, default: false },
    advanceAmount: { type: Number },
    advanceDate: { type: Date },
    advanceNote: { type: String },
    advanceBankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    availableCtn: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

function round2(n: number) {
  return Math.round(n * 100) / 100
}

IndiaBuyingEntrySchema.pre('save', function (next) {
  const doc = this
  doc.totalQty = doc.totalCtn * doc.qty
  doc.totalAmount = Math.round(doc.totalQty * doc.rate)
  doc.finalCost = doc.rate
  doc.remainingAmount = round2(doc.totalAmount - (doc.givenAmount ?? 0))
  if (doc.totalAmount === 0) doc.currentStatus = 'unpaid'
  else if (doc.remainingAmount <= 0) doc.currentStatus = 'paid'
  else if ((doc.givenAmount ?? 0) === 0) doc.currentStatus = 'unpaid'
  else doc.currentStatus = 'partiallypaid'
  next()
})

IndiaBuyingEntrySchema.index({ product: 1 })
IndiaBuyingEntrySchema.index({ entryDate: -1 })
IndiaBuyingEntrySchema.index({ product: 1, createdAt: 1 })

if (models.IndiaBuyingEntry) {
  delete (models as Record<string, mongoose.Model<unknown>>).IndiaBuyingEntry
}

const IndiaBuyingEntry = model<IIndiaBuyingEntry>('IndiaBuyingEntry', IndiaBuyingEntrySchema)
export default IndiaBuyingEntry
