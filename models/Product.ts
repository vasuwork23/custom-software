import mongoose, { Schema, model, models } from 'mongoose'

export interface IProduct {
  _id?: mongoose.Types.ObjectId
  productName: string
  productDescription?: string
  productImage?: string
  // Manual per-CTN measurements, used by Product Insights when buying entries lack them
  ctnWeightKg?: number | null
  ctnCbm?: number | null
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ProductSchema = new Schema<IProduct>(
  {
    productName: { type: String, required: true },
    productDescription: { type: String },
    productImage: { type: String },
    ctnWeightKg: { type: Number, default: null },
    ctnCbm: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ProductSchema.index({ productName: 1 }, { unique: true })

if (models.Product) {
  delete (models as Record<string, mongoose.Model<unknown>>).Product
}

const Product = model<IProduct>('Product', ProductSchema)
export default Product
