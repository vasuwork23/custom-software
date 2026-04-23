import mongoose, { Schema, model, models } from 'mongoose'

export interface IInvestment {
  _id?: mongoose.Types.ObjectId
  investorName: string
  currentBalance: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const InvestmentSchema = new Schema<IInvestment>(
  {
    investorName: { type: String, required: true, trim: true },
    currentBalance: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

InvestmentSchema.index({ investorName: 1 }, { unique: true })

if (models.Investment) {
  delete (models as Record<string, mongoose.Model<unknown>>).Investment
}

const Investment = model<IInvestment>('Investment', InvestmentSchema)
export default Investment
