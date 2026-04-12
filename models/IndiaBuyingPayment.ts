import mongoose, { Schema, model, models } from 'mongoose'

export interface IIndiaBuyingPayment {
  _id?: mongoose.Types.ObjectId
  buyingEntry: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  // Either bankAccount (bank path) or company (set-off path) is set — not both
  bankAccount?: mongoose.Types.ObjectId
  company?: mongoose.Types.ObjectId
  paymentSource: 'bank' | 'company'
  linkedPaymentReceiptId?: mongoose.Types.ObjectId // set when paymentSource === 'company'
  amount: number // INR ₹
  paymentDate: Date
  notes?: string
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const IndiaBuyingPaymentSchema = new Schema<IIndiaBuyingPayment>(
  {
    buyingEntry: { type: Schema.Types.ObjectId, ref: 'IndiaBuyingEntry', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'IndiaProduct', required: true },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    company: { type: Schema.Types.ObjectId, ref: 'Company' },
    paymentSource: { type: String, enum: ['bank', 'company'], required: true, default: 'bank' },
    linkedPaymentReceiptId: { type: Schema.Types.ObjectId, ref: 'PaymentReceipt' },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

IndiaBuyingPaymentSchema.index({ buyingEntry: 1 })
IndiaBuyingPaymentSchema.index({ bankAccount: 1, paymentDate: -1 })
IndiaBuyingPaymentSchema.index({ company: 1, paymentDate: -1 })

if (models.IndiaBuyingPayment) {
  delete (models as Record<string, mongoose.Model<unknown>>).IndiaBuyingPayment
}

const IndiaBuyingPayment = model<IIndiaBuyingPayment>('IndiaBuyingPayment', IndiaBuyingPaymentSchema)
export default IndiaBuyingPayment
