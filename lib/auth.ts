import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import User from '@/models/User'
import { connectDB } from '@/lib/mongodb'

const JWT_SECRET_RAW = process.env.JWT_SECRET?.trim()
if (!JWT_SECRET_RAW) {
  throw new Error('JWT_SECRET environment variable is required. Set it in .env.local')
}
const JWT_SECRET: string = JWT_SECRET_RAW
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d'

export interface JwtPayload {
  userId: string
  email: string
  role: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(
    payload as object,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY } as jwt.SignOptions
  ) as string
}

export function verifyToken(
  request: NextRequest
): JwtPayload | null {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '') ?? request.cookies.get('token')?.value

  if (!token) return null

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    return decoded
  } catch {
    return null
  }
}

export async function getUserFromRequest(
  request: NextRequest
): Promise<{ id: string; fullName: string; email: string; role: string } | null> {
  const payload = verifyToken(request)
  if (!payload) return null

  await connectDB()
  const user = await User.findById(payload.userId)
    .select('_id fullName email role status isBlocked')
    .lean()

  if (!user || user.status !== 'active' || user.isBlocked) {
    return null
  }

  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  }
}

type UserRole = 'owner' | 'admin' | 'manager' | 'viewer'

export async function requireAuth(
  request: NextRequest,
  roles?: UserRole[]
): Promise<{
  user: { id: string; fullName: string; email: string; role: string } | null
  error?: string
}> {
  const user = await getUserFromRequest(request)
  if (!user) {
    return { user: null, error: 'Unauthorized' }
  }

  if (roles && !roles.includes(user.role as UserRole)) {
    return { user: null, error: 'Forbidden' }
  }

  return { user, error: undefined }
}

/** Resolve a User ObjectId for createdBy/updatedBy. Call after connectDB(). */
export async function resolveCreatedBy(userId: string): Promise<mongoose.Types.ObjectId> {
  if (mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId)
  }
  throw new Error('Invalid user id for createdBy/updatedBy.')
}
