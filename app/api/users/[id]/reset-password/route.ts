import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDB } from '@/lib/mongodb'
import { getUserFromRequest } from '@/lib/auth'
import User from '@/models/User'
import { ensureOwner } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const resetSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getUserFromRequest(req)
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const access = ensureOwner(currentUser)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: access.message ?? 'Only Owner can reset passwords' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const parsed = resetSchema.safeParse(body)
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

    await connectDB()
    const user = await User.findById(params.id).select('+password')
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'User not found' },
        { status: 404 }
      )
    }

    user.password = parsed.data.newPassword
    await user.save()

    return NextResponse.json({
      success: true,
      data: { id: String(user._id) },
      message: 'Password reset successfully',
    })
  } catch (error) {
    console.error('Reset password API Error:', error)
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

