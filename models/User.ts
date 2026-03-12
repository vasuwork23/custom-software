import mongoose, { Schema, model, models } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser {
  _id?: mongoose.Types.ObjectId
  fullName: string
  email: string
  password: string
  role: 'owner' | 'admin' | 'manager' | 'viewer'
  status: 'active' | 'inactive'
  failedLoginAttempts: number
  isBlocked: boolean
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      required: true,
      enum: ['owner', 'admin', 'manager', 'viewer'],
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    failedLoginAttempts: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
)

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

if (models.User) {
  delete (models as Record<string, mongoose.Model<unknown>>).User
}

const User = model<IUser>('User', UserSchema)
export default User
