import mongoose, { Schema, model, models } from 'mongoose'

export interface IInvestmentTransaction {
  _id?: mongoose.Types.ObjectId
  investment: mongoose.Types.ObjectId
  type: 'add' | 'withdraw'
  amount: number
  balanceAfter: number
  transactionDate: Date
  note?: string
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const InvestmentTransactionSchema = new Schema<IInvestmentTransaction>(
  {
    investment: { type: Schema.Types.ObjectId, ref: 'Investment', required: true },
    type: { type: String, enum: ['add', 'withdraw'], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    transactionDate: { type: Date, required: true },
    note: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

InvestmentTransactionSchema.index({ investment: 1, transactionDate: -1, createdAt: -1 })

if (models.InvestmentTransaction) {
  delete (models as Record<string, mongoose.Model<unknown>>).InvestmentTransaction
}

const InvestmentTransaction = model<IInvestmentTransaction>(
  'InvestmentTransaction',
  InvestmentTransactionSchema
)

export default InvestmentTransaction
