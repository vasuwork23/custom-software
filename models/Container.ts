import mongoose, { Schema, model, models } from 'mongoose'

export type ContainerStatus = 'loading' | 'in_transit' | 'customs_clearance' | 'arrived'

export interface IContainerEntry {
  buyingEntry: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  ctnCount: number
  cbm: number
  weight?: number
}

export interface IContainer {
  _id?: mongoose.Types.ObjectId
  containerId: string
  containerName: string
  remarks?: string
  status: ContainerStatus
  loadingDate?: Date
  dispatchDate?: Date
  estimatedArrival?: Date
  arrivedDate?: Date
  warehouseDate?: Date
  reachedIndiaWarehouse: boolean
  entries: IContainerEntry[]
  totalCtn: number
  totalCbm: number
  totalWeight: number
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ContainerEntrySchema = new Schema<IContainerEntry>(
  {
    buyingEntry: { type: Schema.Types.ObjectId, ref: 'BuyingEntry', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    ctnCount: { type: Number, required: true, min: 1 },
    cbm: { type: Number, required: true, default: 0 },
    weight: { type: Number, default: 0 },
  },
  { _id: false }
)

const ContainerSchema = new Schema<IContainer>(
  {
    containerId: { type: String, required: true, trim: true, unique: true },
    containerName: { type: String, required: true, trim: true },
    remarks: { type: String, trim: true },
    status: {
      type: String,
      enum: ['loading', 'in_transit', 'customs_clearance', 'arrived'],
      default: 'loading',
    },
    loadingDate: { type: Date },
    dispatchDate: { type: Date },
    estimatedArrival: { type: Date },
    arrivedDate: { type: Date },
    warehouseDate: { type: Date },
    reachedIndiaWarehouse: { type: Boolean, default: false },
    entries: {
      type: [ContainerEntrySchema],
      default: [],
    },
    totalCtn: { type: Number, default: 0 },
    totalCbm: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ContainerSchema.pre('save', function (next) {
  const doc = this
  let totalCtn = 0
  let totalCbm = 0
  let totalWeight = 0
  for (const e of doc.entries) {
    totalCtn += e.ctnCount
    totalCbm += e.cbm ?? 0
    totalWeight += e.weight ?? 0
  }
  doc.totalCtn = totalCtn
  doc.totalCbm = Math.round(totalCbm * 100) / 100
  doc.totalWeight = Math.round(totalWeight * 100) / 100
  next()
})

ContainerSchema.index({ status: 1 })
ContainerSchema.index({ createdAt: -1 })

if (models.Container) {
  delete (models as Record<string, mongoose.Model<unknown>>).Container
}

const Container = model<IContainer>('Container', ContainerSchema)
export default Container
