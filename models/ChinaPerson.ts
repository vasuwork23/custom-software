import mongoose, { Schema, model, models } from 'mongoose'

export interface IChinaPerson {
  _id?: mongoose.Types.ObjectId
  name: string
  isDefault: boolean
  currentBalance: number
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ChinaPersonSchema = new Schema<IChinaPerson>(
  {
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    currentBalance: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

if (models.ChinaPerson) {
  delete (models as Record<string, mongoose.Model<unknown>>).ChinaPerson
}

const ChinaPerson = model<IChinaPerson>('ChinaPerson', ChinaPersonSchema)
export default ChinaPerson
