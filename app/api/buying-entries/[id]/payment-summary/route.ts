import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * GET total paid for this buying entry (advance + all additional payments).
 * Used by delete confirmation to show "¥X total will be restored (N payments)".
 */
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
        { success: false, error: 'Validation failed', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await BuyingEntry.findById(id).lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    const advanceAmount =
      (entry as { hasAdvancePayment?: boolean }).hasAdvancePayment === true
        ? Number((entry as { advanceAmount?: number }).advanceAmount) || 0
        : 0

    const additionalPayments = await BuyingPayment.find({ buyingEntry: new mongoose.Types.ObjectId(id) })
      .lean()
    const additionalTotal = additionalPayments.reduce((s, p) => s + p.amount, 0)

    const totalPaid = advanceAmount + additionalTotal
    const paymentCount = (advanceAmount > 0 ? 1 : 0) + additionalPayments.length

    return NextResponse.json({
      success: true,
      data: {
        totalPaid,
        paymentCount,
        advanceAmount,
        additionalCount: additionalPayments.length,
        additionalTotal,
        transactions: [
          ...(advanceAmount > 0 ? [{ type: 'advance', amount: advanceAmount }] : []),
          ...additionalPayments.map((p) => ({ type: 'payment', amount: p.amount, _id: p._id })),
        ],
      },
    })
  } catch (error) {
    console.error('Buying entry payment-summary API Error:', error)
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
