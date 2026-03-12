import mongoose, { Schema, model, models } from 'mongoose'

export interface IBuyingPayment {
  _id?: mongoose.Types.ObjectId
  buyingEntry: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  chinaPerson: mongoose.Types.ObjectId
  amount: number // RMB ¥
  paymentDate: Date
  notes?: string
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BuyingPaymentSchema = new Schema<IBuyingPayment>(
  {
    buyingEntry: { type: Schema.Types.ObjectId, ref: 'BuyingEntry', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    chinaPerson: { type: Schema.Types.ObjectId, ref: 'ChinaPerson', required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

BuyingPaymentSchema.index({ buyingEntry: 1 })
BuyingPaymentSchema.index({ chinaPerson: 1, paymentDate: -1 })

if (models.BuyingPayment) {
  delete (models as Record<string, mongoose.Model<unknown>>).BuyingPayment
}

const BuyingPayment = model<IBuyingPayment>('BuyingPayment', BuyingPaymentSchema)
export default BuyingPayment
