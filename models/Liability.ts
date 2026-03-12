import mongoose, { Schema, model, models } from 'mongoose'

export interface ILiability {
  _id?: mongoose.Types.ObjectId
  amount: number
  reason: string
  source: 'cash' | 'bank'
  bankAccountId?: mongoose.Types.ObjectId | null
  bankAccountName?: string
  status: 'blocked' | 'unblocked'
  blockedAt: Date
  unblockedAt?: Date | null
  unblockedReason?: string | null
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
}

const LiabilitySchema = new Schema<ILiability>(
  {
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    source: {
      type: String,
      enum: ['cash', 'bank'],
      required: true,
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      default: null,
    },
    bankAccountName: { type: String },
    status: {
      type: String,
      enum: ['blocked', 'unblocked'],
      default: 'blocked',
    },
    blockedAt: { type: Date, default: Date.now },
    unblockedAt: { type: Date, default: null },
    unblockedReason: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
)

LiabilitySchema.index({ source: 1, status: 1, blockedAt: -1 })

if (models.Liability) {
  delete (models as Record<string, mongoose.Model<unknown>>).Liability
}

const Liability = model<ILiability>('Liability', LiabilitySchema)
export default Liability

