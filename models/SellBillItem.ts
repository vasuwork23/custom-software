import mongoose, { Schema, model, models } from 'mongoose'

export interface IFifoBreakdownItem {
  buyingEntry?: mongoose.Types.ObjectId // China: ref BuyingEntry
  indiaBuyingEntry?: mongoose.Types.ObjectId // India: ref IndiaBuyingEntry
  ctnConsumed: number
  pcsConsumed: number
  finalCost: number
  profit: number
}

export interface ISellBillItem {
  _id?: mongoose.Types.ObjectId
  sellBill: mongoose.Types.ObjectId
  productSource: 'china' | 'india'
  product: mongoose.Types.ObjectId // ref Product (China)
  indiaProduct?: mongoose.Types.ObjectId // ref IndiaProduct (when productSource=india)
  ctnSold: number
  pcsSold: number
  ratePerPcs: number
  totalAmount: number
  fifoBreakdown: IFifoBreakdownItem[]
  fifoNote?: string
  totalProfit: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const FifoBreakdownSchema = new Schema<IFifoBreakdownItem>(
  {
    buyingEntry: { type: Schema.Types.ObjectId, ref: 'BuyingEntry' },
    indiaBuyingEntry: { type: Schema.Types.ObjectId, ref: 'IndiaBuyingEntry' },
    ctnConsumed: { type: Number, required: true },
    pcsConsumed: { type: Number, required: true },
    finalCost: { type: Number, required: true },
    profit: { type: Number, required: true },
  },
  { _id: false }
)

const SellBillItemSchema = new Schema<ISellBillItem>(
  {
    sellBill: { type: Schema.Types.ObjectId, ref: 'SellBill', required: true },
    productSource: { type: String, required: true, enum: ['china', 'india'] },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    indiaProduct: { type: Schema.Types.ObjectId, ref: 'IndiaProduct' },
    ctnSold: { type: Number, required: true },
    pcsSold: { type: Number, required: true },
    ratePerPcs: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    fifoBreakdown: [FifoBreakdownSchema],
    fifoNote: { type: String },
    totalProfit: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

SellBillItemSchema.index({ sellBill: 1 })
SellBillItemSchema.index({ product: 1 })
SellBillItemSchema.index({ indiaProduct: 1 })

if (models.SellBillItem) {
  delete (models as Record<string, mongoose.Model<unknown>>).SellBillItem
}

const SellBillItem = model<ISellBillItem>('SellBillItem', SellBillItemSchema)
export default SellBillItem
