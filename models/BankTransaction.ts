import mongoose, { Schema, model, models } from 'mongoose'

export interface IBankTransaction {
  _id?: mongoose.Types.ObjectId
  bankAccount: mongoose.Types.ObjectId
  type: 'credit' | 'debit'
  amount: number
  balanceAfter: number
  source:
    | 'manual_add'
    | 'cash_in'
    | 'china_bank_payment'
    | 'payment_receipt'
    | 'transfer'
    | 'expense'
    | 'manual'
    | 'india_buying_payment'
    | 'india_buying_advance'
    | 'cashbook_sale'
  sourceRef?: mongoose.Types.ObjectId
  sourceLabel?: string
  transferTo?: mongoose.Types.ObjectId
  transactionDate: Date
  notes?: string
  /** 0 = normal, 1 = reversal (sorts after original on same date) */
  sortOrder?: number
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BankTransactionSchema = new Schema<IBankTransaction>(
  {
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    type: { type: String, required: true, enum: ['credit', 'debit'] },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    source: {
      type: String,
      required: true,
      enum: [
        'manual_add',
        'cash_in',
        'china_bank_payment',
        'payment_receipt',
        'transfer',
        'expense',
        'manual',
        'india_buying_payment',
        'india_buying_advance',
        'cashbook_sale',
      ],
      default: 'manual',
    },
    sourceRef: { type: Schema.Types.ObjectId },
    sourceLabel: { type: String },
    transferTo: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    transactionDate: { type: Date, required: true },
    notes: { type: String },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

BankTransactionSchema.index({ bankAccount: 1, transactionDate: -1 })
BankTransactionSchema.index({ source: 1, sourceRef: 1 })

if (models.BankTransaction) {
  delete (models as Record<string, mongoose.Model<unknown>>).BankTransaction
}

const BankTransaction = model<IBankTransaction>(
  'BankTransaction',
  BankTransactionSchema
)
export default BankTransaction
