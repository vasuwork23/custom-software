import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CashTransaction from '@/models/CashTransaction'

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

    const all = await CashTransaction.find({}).lean()



    const sorted = await CashTransaction.find({})
      .sort({ date: 1, sortOrder: 1, createdAt: 1 })
      .lean()



    return NextResponse.json({
      success: true,
      totalCount: all.length,
      all: all.map((tx) => ({
        _id: (tx as { _id?: unknown })._id,
        type: (tx as { type?: string }).type,
        amount: (tx as { amount?: number }).amount,
        date: (tx as { date?: unknown }).date,
        dateType: typeof (tx as { date?: unknown }).date,
        createdAt: (tx as { createdAt?: unknown }).createdAt,
        sortOrder: (tx as { sortOrder?: number }).sortOrder,
        isReversal: (tx as { isReversal?: boolean }).isReversal,
        description: (tx as { description?: string }).description?.slice(0, 60),
      })),
      sorted: sorted.map((tx, i) => ({
        index: i,
        type: (tx as { type?: string }).type,
        amount: (tx as { amount?: number }).amount,
        date: (tx as { date?: unknown }).date,
      })),
    })
  } catch (error) {
    console.error('Debug cash transactions Error:', error)
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
