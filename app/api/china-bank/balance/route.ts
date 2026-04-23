import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    await connectDB()

    const lastTx = await ChinaBankTransaction.findOne()
      .sort({ createdAt: -1 })
      .select('balanceAfter')
      .lean()

    const balance = lastTx?.balanceAfter ?? 0

    return NextResponse.json({
      success: true,
      data: { balance, isNegative: balance < 0 },
    })
  } catch (error) {
    console.error('China Bank balance API Error:', error)
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
