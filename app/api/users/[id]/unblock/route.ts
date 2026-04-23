import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { getUserFromRequest } from '@/lib/auth'
import User from '@/models/User'
import { ensureOwner } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

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
        { success: false, error: 'Forbidden', message: access.message ?? 'Only Owner can unblock users' },
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

    user.isBlocked = false
    user.failedLoginAttempts = 0
    await user.save({ validateBeforeSave: false })

    return NextResponse.json({
      success: true,
      data: { id: String(user._id) },
      message: 'User unblocked successfully',
    })
  } catch (error) {
    console.error('Unblock user API Error:', error)
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

