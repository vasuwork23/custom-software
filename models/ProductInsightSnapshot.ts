import mongoose, { Schema, model, models } from 'mongoose'

/** One product's health for one week, so score movement can be shown over time. */
export interface IProductInsightSnapshot {
  _id?: mongoose.Types.ObjectId
  source: 'china' | 'india'
  product: mongoose.Types.ObjectId
  weekStart: Date // Monday 00:00 UTC
  score: number | null
  label: string
  sold30: number
  marginPct: number | null
  profitPerCbm: number | null
  availableCtn: number
  createdAt: Date
  updatedAt: Date
}

const ProductInsightSnapshotSchema = new Schema<IProductInsightSnapshot>(
  {
    source: { type: String, required: true, enum: ['china', 'india'] },
    product: { type: Schema.Types.ObjectId, required: true },
    weekStart: { type: Date, required: true },
    score: { type: Number, default: null },
    label: { type: String, required: true },
    sold30: { type: Number, default: 0 },
    marginPct: { type: Number, default: null },
    profitPerCbm: { type: Number, default: null },
    availableCtn: { type: Number, default: 0 },
  },
  { timestamps: true }
)

ProductInsightSnapshotSchema.index({ source: 1, product: 1, weekStart: 1 }, { unique: true })
ProductInsightSnapshotSchema.index({ source: 1, weekStart: 1 })

if (models.ProductInsightSnapshot) {
  delete (models as Record<string, mongoose.Model<unknown>>).ProductInsightSnapshot
}

const ProductInsightSnapshot = model<IProductInsightSnapshot>('ProductInsightSnapshot', ProductInsightSnapshotSchema)
export default ProductInsightSnapshot
