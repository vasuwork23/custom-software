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

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)))
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) (filter.createdAt as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(filter.createdAt as Record<string, Date>).$lte = end
      }
    }

    const all = await ChinaBankTransaction.find(filter)
      .sort({ createdAt: 1 })
      .lean()

    let balance = 0
    const withBalance = all.map((tx) => {
      if (tx.type === 'credit') {
        balance += tx.amount
      } else if (tx.type === 'debit') {
        balance -= tx.amount
      } else if (tx.type === 'reversal') {
        balance += tx.amount
      }
      return { ...tx, runningBalance: balance }
    })

    const reversed = [...withBalance].reverse()
    const total = reversed.length
    const start = (page - 1) * limit
    const pageItems = reversed.slice(start, start + limit)

    return NextResponse.json({
      success: true,
      data: {
        transactions: pageItems,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    })
  } catch (error) {
    console.error('China Bank transactions API Error:', error)
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
