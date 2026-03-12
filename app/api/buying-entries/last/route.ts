import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * GET /api/buying-entries/last?productId=...
 * Returns the most recent buying entry for the product (for prefill when adding a new entry).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const productId = searchParams.get('productId')

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'productId is required' },
        { status: 400 }
      )
    }

    await connectDB()

    const lastEntry = await BuyingEntry.findOne({ product: new mongoose.Types.ObjectId(productId) })
      .sort({ createdAt: -1 })
      .select('qty rate cbm weight carryingRate avgRmbRate')
      .lean()

    if (!lastEntry) {
      return NextResponse.json({ success: true, data: { entry: null } })
    }

    return NextResponse.json({
      success: true,
      data: {
        entry: {
          qty: lastEntry.qty,
          rate: lastEntry.rate,
          cbm: lastEntry.cbm,
          weight: lastEntry.weight,
          carryingRate: lastEntry.carryingRate,
          avgRmbRate: lastEntry.avgRmbRate,
        },
      },
    })
  } catch (error) {
    console.error('Buying entries last API Error:', error)
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
