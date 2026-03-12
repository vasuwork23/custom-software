import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import { getUserFromRequest } from '@/lib/auth'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const parsed = changePasswordSchema.safeParse(body)
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

    const { currentPassword, newPassword } = parsed.data

    await connectDB()
    const dbUser = await User.findById(user.id).select('+password').lean()
    if (!dbUser) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'User not found' },
        { status: 404 }
      )
    }

    const match = await bcrypt.compare(currentPassword, dbUser.password)
    if (!match) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials', message: 'Current password is incorrect' },
        { status: 401 }
      )
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    await User.findByIdAndUpdate(user.id, { password: hashed })

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    })
  } catch (error) {
    console.error('Change password API Error:', error)
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
