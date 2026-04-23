import mongoose, { Schema, model, models } from 'mongoose'

export interface IPaymentReceipt {
  _id?: mongoose.Types.ObjectId
  company: mongoose.Types.ObjectId
  amount: number
  paymentMode: 'cash' | 'online' | 'set_off'
  bankAccount?: mongoose.Types.ObjectId
  paymentDate: Date
  remark?: string
  companyNote?: string
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const PaymentReceiptSchema = new Schema<IPaymentReceipt>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, required: true, enum: ['cash', 'online', 'set_off'] },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    paymentDate: { type: Date, required: true },
    remark: { type: String },
    companyNote: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

PaymentReceiptSchema.index({ company: 1 })
PaymentReceiptSchema.index({ paymentDate: -1 })
PaymentReceiptSchema.index({ paymentMode: 1 })

if (models.PaymentReceipt) {
  delete (models as Record<string, mongoose.Model<unknown>>).PaymentReceipt
}

const PaymentReceipt = model<IPaymentReceipt>('PaymentReceipt', PaymentReceiptSchema)
export default PaymentReceipt
