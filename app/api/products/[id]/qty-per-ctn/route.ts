import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** Returns qty per CTN from the latest india_warehouse buying entry for this product. Used for sale bill line PCS auto-fill. */
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
        { success: false, error: 'Validation failed', message: 'Invalid product id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await BuyingEntry.findOne({
      product: id,
      chinaWarehouseReceived: 'yes',
      availableCtn: { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .select('qty')
      .lean()

    return NextResponse.json({
      success: true,
      data: { qtyPerCtn: entry?.qty ?? 0 },
    })
  } catch (error) {
    console.error('Product qty-per-ctn API Error:', error)
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
