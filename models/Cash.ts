import mongoose, { Schema, model, models } from 'mongoose'

export interface ICash {
  _id?: mongoose.Types.ObjectId
  balance: number
  updatedAt: Date
}

const CashSchema = new Schema<ICash>(
  {
    balance: { type: Number, default: 0 },
  },
  { timestamps: true }
)

if (models.Cash) {
  delete (models as Record<string, mongoose.Model<unknown>>).Cash
}

const Cash = model<ICash>('Cash', CashSchema)
export default Cash
