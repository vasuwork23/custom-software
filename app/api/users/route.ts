import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDB } from '@/lib/mongodb'
import { getUserFromRequest } from '@/lib/auth'
import User from '@/models/User'
import { ensureOwnerOrAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const userSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['owner', 'admin', 'manager', 'viewer']),
  status: z.enum(['active', 'inactive']),
})

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getUserFromRequest(req)
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const access = ensureOwnerOrAdmin(currentUser)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: access.message ?? 'Access denied' },
        { status: 403 }
      )
    }

    await connectDB()
    const users = await User.find({})
      .select('_id fullName email role status failedLoginAttempts isBlocked lastLoginAt createdAt')
      .sort({ createdAt: 1 })
      .lean()

    const list = users.map((u) => ({
      id: String(u._id),
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      failedLoginAttempts: u.failedLoginAttempts ?? 0,
      isBlocked: u.isBlocked ?? false,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }))

    return NextResponse.json({
      success: true,
      data: { users: list },
    })
  } catch (error) {
    console.error('Users list API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getUserFromRequest(req)
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const access = ensureOwnerOrAdmin(currentUser)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: access.message ?? 'Access denied' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const parsed = userSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: parsed.error.errors[0]?.message ?? 'Invalid input',
        },
        { status: 400 }
      )
    }
    const payload = parsed.data

    // Only Owner can assign Owner role
    if (payload.role === 'owner' && currentUser.role !== 'owner') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Only Owner can create users with Owner role',
        },
        { status: 403 }
      )
    }

    await connectDB()
    const existing = await User.findOne({ email: payload.email.toLowerCase() }).select('_id').lean()
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'Conflict',
          message: 'Email is already in use',
        },
        { status: 409 }
      )
    }

    const user = await User.create({
      fullName: payload.fullName.trim(),
      email: payload.email.toLowerCase(),
      password: payload.password,
      role: payload.role,
      status: payload.status,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: String(user._id),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        failedLoginAttempts: user.failedLoginAttempts ?? 0,
        isBlocked: user.isBlocked ?? false,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    console.error('Create user API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

