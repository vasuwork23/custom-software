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
    const typesParam = searchParams.get('types')?.trim() ?? ''
    const selectedTypes = typesParam
      ? typesParam.split(',').filter((t): t is 'credit' | 'debit' | 'reversal' =>
          ['credit', 'debit', 'reversal'].includes(t)
        )
      : []

    await connectDB()

    // Fetch ALL transactions for running balance, then apply date + type filters for display
    const all = await ChinaBankTransaction.find({}).sort({ createdAt: 1 }).lean()

    let balance = 0
    const withBalance = all.map((tx) => {
      if (tx.type === 'credit') balance += tx.amount
      else if (tx.type === 'debit') balance -= tx.amount
      else if (tx.type === 'reversal') balance += tx.amount
      return { ...tx, runningBalance: balance }
    })

    // Apply date filter
    let filtered = withBalance
    if (startDate || endDate) {
      const startMs = startDate ? new Date(startDate).getTime() : null
      const endObj = endDate ? new Date(endDate) : null
      if (endObj) endObj.setHours(23, 59, 59, 999)
      const endMs = endObj ? endObj.getTime() : null
      filtered = filtered.filter((tx) => {
        const tMs = new Date(tx.transactionDate).getTime()
        if (startMs != null && tMs < startMs) return false
        if (endMs != null && tMs > endMs) return false
        return true
      })
    }

    // Apply type filter (only when specific types are selected)
    if (selectedTypes.length > 0) {
      filtered = filtered.filter((tx) => selectedTypes.includes(tx.type as 'credit' | 'debit' | 'reversal'))
    }

    const reversed = [...filtered].reverse()
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
