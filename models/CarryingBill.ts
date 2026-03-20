import mongoose, { Schema, model, models } from 'mongoose'

export interface ICarryingProduct {
  _id?: mongoose.Types.ObjectId
  productName: string
  totalCBM: number
  priceBuyCBM: number
  priceSellCBM: number
  totalAmount: number
  totalProfit: number
}

export interface ICarryingBill {
  _id?: mongoose.Types.ObjectId
  containerName: string
  companyName: string
  products: ICarryingProduct[]
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const CarryingProductSchema = new Schema<ICarryingProduct>(
  {
    productName: { type: String, required: true },
    totalCBM: { type: Number, required: true, default: 0 },
    priceBuyCBM: { type: Number, required: true, default: 0 },
    priceSellCBM: { type: Number, required: true, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 },
    totalProfit: { type: Number, required: true, default: 0 },
  },
  { _id: true }
)

const CarryingBillSchema = new Schema<ICarryingBill>(
  {
    containerName: { type: String, required: true },
    companyName: { type: String, required: true },
    products: { type: [CarryingProductSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

CarryingBillSchema.index({ createdAt: -1 })
CarryingBillSchema.index({ containerName: 1 })
CarryingBillSchema.index({ companyName: 1 })

if (models.CarryingBill) {
  delete (models as Record<string, mongoose.Model<unknown>>).CarryingBill
}

const CarryingBill = model<ICarryingBill>('CarryingBill', CarryingBillSchema)
export default CarryingBill

