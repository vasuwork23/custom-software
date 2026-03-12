import mongoose, { Schema, model, models } from 'mongoose'

export interface IIndiaBuyingPayment {
  _id?: mongoose.Types.ObjectId
  buyingEntry: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  bankAccount: mongoose.Types.ObjectId
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
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

IndiaBuyingPaymentSchema.index({ buyingEntry: 1 })
IndiaBuyingPaymentSchema.index({ bankAccount: 1, paymentDate: -1 })

if (models.IndiaBuyingPayment) {
  delete (models as Record<string, mongoose.Model<unknown>>).IndiaBuyingPayment
}

const IndiaBuyingPayment = model<IIndiaBuyingPayment>('IndiaBuyingPayment', IndiaBuyingPaymentSchema)
export default IndiaBuyingPayment
