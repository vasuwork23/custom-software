import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CarryingBill from '@/models/CarryingBill'
import { ensureCanDelete } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const perm = ensureCanDelete(user)
    if (!perm.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: perm.message },
        { status: 403 }
      )
    }


    const id = params.id
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid id' },
        { status: 400 }
      )
    }

    await connectDB()
    await CarryingBill.findByIdAndDelete(id)

    return NextResponse.json({ success: true, data: true })
  } catch (error) {
    console.error('Carrying delete API Error:', error)
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

