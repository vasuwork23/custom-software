import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import { round, roundCtn } from '@/lib/round'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can run rounding fix' },
        { status: 403 }
      )
    }

    await connectDB()

    const entries = await BuyingEntry.find({}).lean()
    for (const entry of entries) {
      await BuyingEntry.findByIdAndUpdate(entry._id, {
        cbm: round(entry.cbm),
        weight: round(entry.weight),
        totalCbm: round(entry.totalCbm),
        totalWeight: round(entry.totalWeight),
        totalAmount: round(entry.totalAmount),
        rmbInrPurchase: round(entry.rmbInrPurchase),
        totalCarrying: round(entry.totalCarrying),
        totalExpenseINR: round(entry.totalExpenseINR),
        finalCost: round(entry.finalCost),
        shippingCostPerPiece: round(entry.shippingCostPerPiece),
        availableCtn: roundCtn(entry.availableCtn),
        soldCtn: roundCtn(entry.soldCtn),
        chinaWarehouseCtn: roundCtn(entry.chinaWarehouseCtn),
        inTransitCtn: roundCtn(entry.inTransitCtn),
      })
    }

    return NextResponse.json({
      success: true,
      data: { updated: entries.length },
      message: `Rounded numeric fields to ${5} decimal places for ${entries.length} buying entries.`,
    })
  } catch (error) {
    console.error('Fix round-to-5-decimals API Error:', error)
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

