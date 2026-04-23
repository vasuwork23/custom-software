import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDB } from '@/lib/mongodb'
import { getUserFromRequest } from '@/lib/auth'
import User from '@/models/User'
import { ensureOwnerOrAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['owner', 'admin', 'manager', 'viewer']),
  status: z.enum(['active', 'inactive']),
})

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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
    const parsed = updateSchema.safeParse(body)
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

    await connectDB()
    const user = await User.findById(params.id)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'User not found' },
        { status: 404 }
      )
    }

    // Admin cannot manage Owner users; only Owner can
    if (user.role === 'owner' && currentUser.role !== 'owner') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Admin cannot modify Owner account',
        },
        { status: 403 }
      )
    }

    // Only Owner can assign Owner role
    if (payload.role === 'owner' && currentUser.role !== 'owner') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Only Owner can assign Owner role',
        },
        { status: 403 }
      )
    }

    // Email uniqueness (if changed)
    if (payload.email.toLowerCase() !== user.email.toLowerCase()) {
      const existing = await User.findOne({ email: payload.email.toLowerCase() })
        .select('_id')
        .lean()
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
    }

    user.fullName = payload.fullName.trim()
    user.email = payload.email.toLowerCase()
    user.role = payload.role
    user.status = payload.status
    await user.save()

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
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    console.error('Update user API Error:', error)
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

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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
    const user = await User.findById(params.id)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'User not found' },
        { status: 404 }
      )
    }

    if (user.role === 'owner') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete Owner account',
        },
        { status: 400 }
      )
    }

    await User.deleteOne({ _id: user._id })

    return NextResponse.json({
      success: true,
      data: { id: String(user._id) },
    })
  } catch (error) {
    console.error('Delete user API Error:', error)
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

