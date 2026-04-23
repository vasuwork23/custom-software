import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** Returns qty per CTN from the oldest available India buying entry (FIFO order). Used for sale bill line PCS estimate. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid India product id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await IndiaBuyingEntry.findOne({
      product: id,
      availableCtn: { $gt: 0 },
    })
      .sort({ createdAt: 1 })
      .select('qty')
      .lean()

    return NextResponse.json({
      success: true,
      data: { qtyPerCtn: entry?.qty ?? 0 },
    })
  } catch (error) {
    console.error('India product qty-per-ctn API Error:', error)
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
