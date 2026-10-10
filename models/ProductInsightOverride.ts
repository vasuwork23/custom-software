import mongoose, { Schema, model, models } from 'mongoose'

/** A manual call on a product's outlook, used by Product Insights' reorder maths. */
export interface IProductInsightOverride {
  _id?: mongoose.Types.ObjectId
  source: 'china' | 'india'
  product: mongoose.Types.ObjectId // Product or IndiaProduct, depending on source
  tag: 'none' | 'discontinue' | 'hold' | 'competitor' | 'seasonal' | 'push'
  demandAdjustPct: number
  note?: string
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ProductInsightOverrideSchema = new Schema<IProductInsightOverride>(
  {
    source: { type: String, required: true, enum: ['china', 'india'] },
    product: { type: Schema.Types.ObjectId, required: true },
    tag: {
      type: String,
      enum: ['none', 'discontinue', 'hold', 'competitor', 'seasonal', 'push'],
      default: 'none',
    },
    demandAdjustPct: { type: Number, default: 0, min: -100, max: 300 },
    note: { type: String, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ProductInsightOverrideSchema.index({ source: 1, product: 1 }, { unique: true })

if (models.ProductInsightOverride) {
  delete (models as Record<string, mongoose.Model<unknown>>).ProductInsightOverride
}

const ProductInsightOverride = model<IProductInsightOverride>('ProductInsightOverride', ProductInsightOverrideSchema)
export default ProductInsightOverride
