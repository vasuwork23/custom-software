import mongoose, { Schema, model, models } from 'mongoose'

export type CashTransactionCategory =
  | 'cashbook_sale'
  | 'cashbook_sale_edit'
  | 'payment_received'
  | 'expense'
  | 'bank_transfer'
  | 'china_bank_payment'
  | 'china_bank_withdrawal'
  | 'cash_in'
  | 'reversal'
  | 'other'

export interface ICashTransaction {
  _id?: mongoose.Types.ObjectId
  type: 'credit' | 'debit'
  amount: number
  description: string
  date: Date
  category: CashTransactionCategory
  referenceId?: mongoose.Types.ObjectId | null
  referenceType?: string | null
  isReversal?: boolean
  reversalOf?: mongoose.Types.ObjectId | null
  sortOrder?: number
  createdAt: Date
  updatedAt: Date
}

const CashTransactionSchema = new Schema<ICashTransaction>(
  {
    type: { type: String, required: true, enum: ['credit', 'debit'] },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    date: { type: Date, required: true },
    category: {
      type: String,
      enum: [
        'cashbook_sale',
        'cashbook_sale_edit',
        'payment_received',
        'expense',
        'bank_transfer',
        'china_bank_payment',
        'cash_in',
        'reversal',
        'other',
      ],
      default: 'other',
    },
    referenceId: { type: Schema.Types.ObjectId, default: null },
    referenceType: { type: String, default: null },
    isReversal: { type: Boolean, default: false },
    reversalOf: { type: Schema.Types.ObjectId, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
)

CashTransactionSchema.index({ date: -1, sortOrder: 1, createdAt: 1 })
CashTransactionSchema.index({ category: 1 })
CashTransactionSchema.index({ referenceType: 1, referenceId: 1 })

if (models.CashTransaction) {
  delete (models as Record<string, mongoose.Model<unknown>>).CashTransaction
}

const CashTransaction = model<ICashTransaction>('CashTransaction', CashTransactionSchema)
export default CashTransaction
