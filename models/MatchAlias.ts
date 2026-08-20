import mongoose, { Schema, model, models } from 'mongoose'

/**
 * Learned mappings from free-text names (as typed in WhatsApp messages) to
 * catalog records. Written whenever a user confirms/corrects a match in the
 * quick-bill review screen, so the same shorthand resolves instantly next time.
 */
export interface IMatchAlias {
  _id?: mongoose.Types.ObjectId
  aliasNormalized: string
  aliasRaw: string
  targetType: 'product' | 'company' | 'bank'
  productSource?: 'china' | 'india'
  product?: mongoose.Types.ObjectId
  indiaProduct?: mongoose.Types.ObjectId
  company?: mongoose.Types.ObjectId
  bankAccount?: mongoose.Types.ObjectId
  useCount: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const MatchAliasSchema = new Schema<IMatchAlias>(
  {
    aliasNormalized: { type: String, required: true },
    aliasRaw: { type: String, required: true },
    targetType: { type: String, required: true, enum: ['product', 'company', 'bank'] },
    productSource: { type: String, enum: ['china', 'india'] },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    indiaProduct: { type: Schema.Types.ObjectId, ref: 'IndiaProduct' },
    company: { type: Schema.Types.ObjectId, ref: 'Company' },
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount' },
    useCount: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

MatchAliasSchema.index({ aliasNormalized: 1, targetType: 1 }, { unique: true })

if (models.MatchAlias) {
  delete (models as Record<string, mongoose.Model<unknown>>).MatchAlias
}

const MatchAlias = model<IMatchAlias>('MatchAlias', MatchAliasSchema)
export default MatchAlias
