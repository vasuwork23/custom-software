import mongoose, { Schema, model, models } from 'mongoose'

export interface IChinaBankTransaction {
  _id?: mongoose.Types.ObjectId
  type: 'credit' | 'debit' | 'reversal'
  amount: number
  balanceAfter: number
  reference?: string
  buyingEntry?: mongoose.Types.ObjectId
  notes?: string
  transactionDate: Date
  /** 0 = normal, 1 = reversal (sorts after original on same date) */
  sortOrder?: number
  payFrom?: 'cash' | 'bank' | null
  sourceBankAccountId?: mongoose.Types.ObjectId | null
  payTo?: 'cash' | 'bank' | null
  destBankAccountId?: mongoose.Types.ObjectId | null
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ChinaBankTransactionSchema = new Schema<IChinaBankTransaction>(
  {
    type: { type: String, required: true, enum: ['credit', 'debit', 'reversal'] },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reference: { type: String },
    buyingEntry: { type: Schema.Types.ObjectId, ref: 'BuyingEntry' },
    notes: { type: String },
    transactionDate: { type: Date, required: true },
    sortOrder: { type: Number, default: 0 },
    payFrom: { type: String, enum: ['cash', 'bank'], default: null },
    sourceBankAccountId: { type: Schema.Types.ObjectId, default: null },
    payTo: { type: String, enum: ['cash', 'bank'], default: null },
    destBankAccountId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ChinaBankTransactionSchema.index({ transactionDate: -1 })
ChinaBankTransactionSchema.index({ buyingEntry: 1 })

if (models.ChinaBankTransaction) {
  delete (models as Record<string, mongoose.Model<unknown>>).ChinaBankTransaction
}

const ChinaBankTransaction = model<IChinaBankTransaction>(
  'ChinaBankTransaction',
  ChinaBankTransactionSchema
)
export default ChinaBankTransaction
