import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'

export const dynamic = 'force-dynamic'

/**
 * Single unified query for cash transaction history.
 * Never split by type; date range filter uses business date (reversals use original date).
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
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()
    const type = searchParams.get('type') // 'credit' | 'debit' | 'all' | null
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
    const exportAll = searchParams.get('exportAll') === '1'

    await connectDB()

    const query: Record<string, unknown> = {}

    if (startDate || endDate) {
      query.date = {}
      if (startDate) (query.date as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(query.date as Record<string, Date>).$lte = end
      }
    }

    if (type && type !== 'all') {
      if (type === 'credit' || type === 'debit') query.type = type
    }

    const total = await CashTransaction.countDocuments(query)

    // Single query — sort oldest first for running balance calculation
    // sortOrder ensures reversals (sortOrder:1) appear right after their originals within same createdAt
    const allInRange = await CashTransaction.find(query)
      .sort({ date: 1, createdAt: 1, sortOrder: 1 })
      .lean()

    let runningBalance = 0
    const allWithBalance = allInRange.map((tx) => {
      if (tx.type === 'credit') {
        runningBalance += tx.amount
      } else {
        runningBalance -= tx.amount
      }
      return {
        ...tx,
        runningBalance: Math.round(runningBalance * 100) / 100,
      }
    })

    // Reverse first for display so page 1 gets newest items
    const forDisplay = exportAll ? allWithBalance : [...allWithBalance].reverse()
    const skip = (page - 1) * limit
    const transactions = exportAll ? forDisplay : forDisplay.slice(skip, skip + limit)

    const cashDoc = await Cash.findOne().lean()
    const currentBalance = cashDoc?.balance ?? 0

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        total,
        currentBalance,
        page,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Cash transactions API Error:', error)
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
