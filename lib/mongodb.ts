import mongoose from 'mongoose'
import env from '@/lib/env'

const MONGODB_URI = env.MONGODB_URI

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined
}

const cached: MongooseCache = global.mongoose ?? { conn: null, promise: null }
let modelsRegistered = false

if (process.env.NODE_ENV !== 'production') {
  global.mongoose = cached
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) {
    if (!modelsRegistered) {
      await import('@/lib/register-models')
      modelsRegistered = true
    }
    return cached.conn
  }

  if (!cached.promise) {
    const opts = { bufferCommands: false }
    cached.promise = mongoose.connect(MONGODB_URI!, opts)
  }

  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }

  if (!modelsRegistered) {
    await import('@/lib/register-models')
    modelsRegistered = true
  }

  return cached.conn
}

export default connectDB
