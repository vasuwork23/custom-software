import mongoose, { Schema, model, models } from 'mongoose'

export interface IIndiaProduct {
  _id?: mongoose.Types.ObjectId
  productName: string
  productDescription?: string
  productImage?: string
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const IndiaProductSchema = new Schema<IIndiaProduct>(
  {
    productName: { type: String, required: true },
    productDescription: { type: String },
    productImage: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

IndiaProductSchema.index({ productName: 1 }, { unique: true })

if (models.IndiaProduct) {
  delete (models as Record<string, mongoose.Model<unknown>>).IndiaProduct
}

const IndiaProduct = model<IIndiaProduct>('IndiaProduct', IndiaProductSchema)
export default IndiaProduct
