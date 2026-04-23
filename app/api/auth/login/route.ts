import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import { signToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.ip ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown'
    const { allowed, remaining } = checkRateLimit(ip)
    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too Many Requests',
          message: 'Too many login attempts. Please try again after 15 minutes.',
        },
        { status: 429 }
      )
    }

    const body = await req.json()
    const validated = loginSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: validated.error.errors[0]?.message ?? 'Invalid input',
        },
        { status: 400 }
      )
    }

    const { email, password } = validated.data

    await connectDB()

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password failedLoginAttempts isBlocked')
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid credentials',
          message: 'Invalid email or password',
        },
        { status: 401 }
      )
    }

    if (user.isBlocked) {
      return NextResponse.json(
        {
          success: false,
          error: 'Account blocked',
          message: 'Your account has been blocked. Please contact the Owner to unblock.',
        },
        { status: 403 }
      )
    }

    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1
      if (user.failedLoginAttempts >= 10) {
        user.isBlocked = true
        await user.save({ validateBeforeSave: false })
        return NextResponse.json(
          {
            success: false,
            error: 'Account blocked',
            message: 'Your account has been blocked. Please contact the Owner to unblock.',
          },
          { status: 403 }
        )
      }
      await user.save({ validateBeforeSave: false })
      const remaining = Math.max(0, 10 - (user.failedLoginAttempts ?? 0))
      const warning =
        user.failedLoginAttempts >= 7
          ? ` Warning: ${remaining} attempts remaining before account is blocked.`
          : ''
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid credentials',
          message: `Invalid email or password.${warning}`,
        },
        { status: 401 }
      )
    }

    user.failedLoginAttempts = 0
    user.lastLoginAt = new Date()
    await user.save({ validateBeforeSave: false })

    const token = signToken({
      userId: String(user._id),
      email: user.email,
      role: user.role,
    })

    return NextResponse.json({
      success: true,
      data: {
        token,
        user: {
          id: String(user._id),
          fullName: user.fullName,
          email: user.email,
          role: user.role,
        },
      },
    })
  } catch (error) {
    console.error('Login API Error:', error)
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
