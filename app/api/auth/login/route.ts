import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import { signToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

// The app is used by a single account, so the login screen sends only a
// password. `email` stays optional for any caller that still supplies it.
const loginSchema = z.object({
  email: z.string().email('Invalid email').optional(),
  password: z.string().min(1, 'Password is required'),
  // The login screen tries the password as it is typed, so a wrong guess is
  // usually just an unfinished password. Probes get their own IP budget and
  // never count toward the block, otherwise ordinary typing would lock the
  // only account out for good.
  probe: z.boolean().optional(),
})

const PROBE_MAX_ATTEMPTS = 30

const USER_FIELDS = '+password failedLoginAttempts isBlocked'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const ip =
      req.ip ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown'
    const isProbe = body?.probe === true
    const { allowed, remaining } = isProbe
      ? checkRateLimit(ip, { scope: 'login-probe', max: PROBE_MAX_ATTEMPTS })
      : checkRateLimit(ip)
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

    let user = null
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() }).select(USER_FIELDS)
    } else {
      // Password-only login: resolve the single account of this installation.
      const users = await User.find({}).select(USER_FIELDS).limit(2)
      if (users.length === 1) {
        user = users[0]
      } else if (users.length > 1) {
        const owners = await User.find({ role: 'owner' }).select(USER_FIELDS).limit(2)
        if (owners.length !== 1) {
          return NextResponse.json(
            {
              success: false,
              error: 'Validation failed',
              message: 'This installation has multiple accounts. Email is required.',
            },
            { status: 400 }
          )
        }
        user = owners[0]
      }
    }

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid credentials',
          message: email ? 'Invalid email or password' : 'Incorrect password',
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
      // A probe is a half-typed password, not a failed login attempt.
      if (isProbe) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid credentials',
            message: 'Incorrect password',
          },
          { status: 401 }
        )
      }

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
          message: `${email ? 'Invalid email or password' : 'Incorrect password'}.${warning}`,
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
