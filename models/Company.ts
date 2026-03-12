import mongoose, { Schema, model, models } from 'mongoose'

export interface ICompany {
  _id?: mongoose.Types.ObjectId
  companyName: string
  ownerName?: string
  contact1Name?: string
  contact1Mobile?: string
  contact2Name?: string
  contact2Mobile?: string
  gstNumber?: string
  address?: string
  city?: string
  // WhatsApp / reminders
  primaryMobile?: string
  lastWhatsappSentAt?: Date
  lastWhatsappMessage?: string
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const CompanySchema = new Schema<ICompany>(
  {
    companyName: { type: String, required: true },
    ownerName: { type: String },
    contact1Name: { type: String },
    contact1Mobile: { type: String },
    contact2Name: { type: String },
    contact2Mobile: { type: String },
    gstNumber: { type: String },
    address: { type: String },
    city: { type: String },
    primaryMobile: { type: String },
    lastWhatsappSentAt: { type: Date },
    lastWhatsappMessage: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

CompanySchema.index({ companyName: 1 })
CompanySchema.index({ city: 1 })

if (models.Company) {
  delete (models as Record<string, mongoose.Model<unknown>>).Company
}

const Company = model<ICompany>('Company', CompanySchema)
export default Company
