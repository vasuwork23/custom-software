import mongoose, { Schema, model, models } from 'mongoose'

export interface ISellBill {
  _id?: mongoose.Types.ObjectId
  billNumber: number
  company: mongoose.Types.ObjectId | null
  isCashbook: boolean
  companyName?: string | null
  billDate: Date
  items: mongoose.Types.ObjectId[]
  totalAmount: number
  extraCharges?: number
  extraChargesNote?: string
  discount?: number
  discountNote?: string
  grandTotal?: number
  notes?: string
  whatsappSent: boolean
  whatsappSentAt?: Date
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const SellBillSchema = new Schema<ISellBill>(
  {
    billNumber: { type: Number, required: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    isCashbook: { type: Boolean, default: false },
    companyName: { type: String, default: null },
    billDate: { type: Date, required: true },
    items: [{ type: Schema.Types.ObjectId, ref: 'SellBillItem' }],
    totalAmount: { type: Number, required: true },
    extraCharges: { type: Number, default: 0 },
    extraChargesNote: { type: String, default: '' },
    discount: { type: Number, default: 0 },
    discountNote: { type: String, default: '' },
    grandTotal: { type: Number, default: 0 },
    notes: { type: String },
    whatsappSent: { type: Boolean, default: false },
    whatsappSentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

SellBillSchema.index({ billNumber: 1 }, { unique: true })
SellBillSchema.index({ company: 1 })
SellBillSchema.index({ billDate: -1 })

if (models.SellBill) {
  delete (models as Record<string, mongoose.Model<unknown>>).SellBill
}

const SellBill = model<ISellBill>('SellBill', SellBillSchema)
export default SellBill
