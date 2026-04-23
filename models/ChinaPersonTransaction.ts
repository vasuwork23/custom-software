import mongoose, { Schema, model, models } from 'mongoose'

export interface IChinaPersonTransaction {
  _id?: mongoose.Types.ObjectId
  chinaPerson: mongoose.Types.ObjectId
  type: 'pay_in' | 'pay_out'
  amount: number
  balanceAfter: number
  transactionDate: Date
  notes?: string
  sourceLabel?: string // e.g. "Payment for [Product] - [Entry Date]" or "Advance for [Product] - [Entry Date]"
  buyingPayment?: mongoose.Types.ObjectId // ref: BuyingPayment — set when pay_out is from product-linked payment
  isReversal?: boolean // true for reversal entries (e.g. advance restored on entry delete) — not deletable
  reversalOf?: mongoose.Types.ObjectId
  /** 0 = normal, 1 = reversal (sorts after original on same date) */
  sortOrder?: number
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ChinaPersonTransactionSchema = new Schema<IChinaPersonTransaction>(
  {
    chinaPerson: {
      type: Schema.Types.ObjectId,
      ref: 'ChinaPerson',
      required: true,
    },
    type: { type: String, required: true, enum: ['pay_in', 'pay_out'] },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    transactionDate: { type: Date, required: true },
    notes: { type: String },
    sourceLabel: { type: String },
    buyingPayment: { type: Schema.Types.ObjectId, ref: 'BuyingPayment' },
    isReversal: { type: Boolean, default: false },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'ChinaPersonTransaction' },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ChinaPersonTransactionSchema.index({ chinaPerson: 1, transactionDate: -1 })

if (models.ChinaPersonTransaction) {
  delete (models as Record<string, mongoose.Model<unknown>>).ChinaPersonTransaction
}

const ChinaPersonTransaction = model<IChinaPersonTransaction>(
  'ChinaPersonTransaction',
  ChinaPersonTransactionSchema
)
export default ChinaPersonTransaction
