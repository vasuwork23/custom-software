import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
        { success: false, error: 'Validation failed', message: 'Invalid company id' },
        { status: 400 }
      )
    }

    await connectDB()
    const companyId = new mongoose.Types.ObjectId(id)

    const [billedRes, receivedRes] = await Promise.all([
      SellBill.aggregate([
        { $match: { company: companyId } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
      ]),
      PaymentReceipt.aggregate([
        { $match: { company: companyId } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ])
    const totalBilled = billedRes[0]?.total ?? 0
    const totalReceived = receivedRes[0]?.total ?? 0
    const outstanding = totalBilled - totalReceived

    return NextResponse.json({
      success: true,
      data: { totalBilled, totalReceived, outstanding },
    })
  } catch (error) {
    console.error('Company outstanding API Error:', error)
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
