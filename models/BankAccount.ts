import mongoose, { Schema, model, models } from 'mongoose'

export interface IBankAccount {
  _id?: mongoose.Types.ObjectId
  accountName: string
  type: 'cash' | 'online'
  isDefault: boolean
  currentBalance: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    accountName: { type: String, required: true },
    type: { type: String, required: true, enum: ['cash', 'online'] },
    isDefault: { type: Boolean, default: false },
    currentBalance: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

if (models.BankAccount) {
  delete (models as Record<string, mongoose.Model<unknown>>).BankAccount
}

const BankAccount = model<IBankAccount>('BankAccount', BankAccountSchema)
export default BankAccount
