import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import Cash from '@/models/Cash'
import CashTransaction from '@/models/CashTransaction'
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
        { success: false, error: 'Validation failed', message: 'Invalid account id' },
        { status: 400 }
      )
    }
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()
    const typeFilter = searchParams.get('type')?.trim() // 'credit' | 'debit' | 'all'
    const search = searchParams.get('search')?.trim() ?? ''
    const exportAll = searchParams.get('exportAll') === '1'

    await connectDB()
    const account = await BankAccount.findById(id).lean()
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Bank account not found' },
        { status: 404 }
      )
    }

    // Cash account uses CashTransaction ledger (single query, running balance by createdAt)
    if ((account as { type?: string }).type === 'cash') {
      const cashQuery: Record<string, unknown> = {}
      if (startDate || endDate) {
        cashQuery.createdAt = {}
        if (startDate) (cashQuery.createdAt as Record<string, Date>).$gte = new Date(startDate)
        if (endDate) {
          const end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          ;(cashQuery.createdAt as Record<string, Date>).$lte = end
        }
      }
      if (typeFilter && typeFilter !== 'all') {
        if (typeFilter === 'credit' || typeFilter === 'debit') cashQuery.type = typeFilter
      }
      const total = await CashTransaction.countDocuments(cashQuery)
      const allInRange = await CashTransaction.find(cashQuery)
        .sort({ createdAt: 1 })
        .lean()
      let running = 0
      const withBalance = allInRange.map((tx) => {
        running += tx.type === 'credit' ? tx.amount : -tx.amount
        return { ...tx, runningBalance: Math.round(running * 100) / 100 }
      })
      const searchFiltered =
        search.length > 0
          ? withBalance.filter((tx) => {
              const haystack = `${tx.description ?? ''} ${tx.category ?? ''} ${
                tx.isReversal ? 'reversal' : ''
              }`.toLowerCase()
              return haystack.includes(search.toLowerCase())
            })
          : withBalance
      const skip = (page - 1) * limit
      const pageSlice = exportAll ? searchFiltered : searchFiltered.slice(skip, skip + limit)
      const transactions = [...pageSlice].reverse()
      const cashDoc = await Cash.findOne().lean()
      const currentBalance = cashDoc?.balance ?? 0
      const list = transactions.map((t) => ({
        _id: t._id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.runningBalance,
        runningBalance: t.runningBalance,
        source: t.category,
        sourceLabel: t.description,
        transactionDate: t.date,
        notes: t.isReversal ? '(reversal)' : '',
      }))
      return NextResponse.json({
        success: true,
        data: {
          account: { _id: account._id, accountName: account.accountName, currentBalance },
          transactions: list,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
      })
    }

    // Non-cash: BankTransaction — fetch all for account, sort oldest first by createdAt, compute running balance, then filter, reverse for display, paginate
    const accountIdObj = new mongoose.Types.ObjectId(id)
    const allTransactions = await BankTransaction.find({ bankAccount: accountIdObj })
      .sort({ createdAt: 1 })
      .lean()

    let runningBalance = 0
    const allWithBalance = allTransactions.map((t) => {
      const effect = t.type === 'credit' ? (t.amount as number) : -(t.amount as number)
      runningBalance += effect
      return {
        ...t,
        runningBalance: parseFloat(runningBalance.toFixed(2)),
      }
    })

    let filtered = allWithBalance
    if (startDate || endDate) {
      const startMs = startDate ? new Date(startDate).getTime() : null
      const endObj = endDate ? new Date(endDate) : null
      if (endObj) endObj.setHours(23, 59, 59, 999)
      const endMs = endObj ? endObj.getTime() : null

      filtered = filtered.filter((tx) => {
        const created = new Date((tx as { createdAt?: Date }).createdAt ?? tx.transactionDate)
        const tMs = created.getTime()
        if (startMs != null && tMs < startMs) return false
        if (endMs != null && tMs > endMs) return false
        return true
      })
    }

    const forDisplay = [...filtered].reverse()
    const totalFiltered = filtered.length
    const paginated = forDisplay.slice((page - 1) * limit, page * limit)

    const searchBase = exportAll ? forDisplay : paginated
    const searchFiltered =
      search.length > 0
        ? searchBase.filter((tx) => {
            const haystack = `${tx.sourceLabel ?? ''} ${tx.notes ?? ''} ${
              tx.source ?? ''
            }`.toLowerCase()
            return haystack.includes(search.toLowerCase())
          })
        : searchBase

    const list = searchFiltered.map((t) => ({
      _id: t._id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.runningBalance,
      runningBalance: t.runningBalance,
      source: t.source,
      sourceLabel: (t.sourceLabel as string) ?? getDefaultSourceLabel(t.source as string),
      transactionDate: t.transactionDate,
      notes: t.notes ?? '',
    }))

    return NextResponse.json({
      success: true,
      data: {
        account: {
          _id: account._id,
          accountName: account.accountName,
          currentBalance: account.currentBalance ?? 0,
        },
        transactions: list,
        pagination: { page, limit, total: totalFiltered, pages: Math.ceil(totalFiltered / limit) },
      },
    })
  } catch (error) {
    console.error('Bank transactions API Error:', error)
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

function getDefaultSourceLabel(source: string): string {
  switch (source) {
    case 'payment_receipt':
      return 'Payment'
    case 'transfer':
      return 'Transfer'
    case 'expense':
      return 'Expense'
    case 'manual':
      return 'Manual'
    case 'cashbook_sale':
      return 'Cashbook sale'
    case 'india_buying_payment':
      return 'India buying payment'
    case 'india_buying_advance':
      return 'India buying advance'
    default:
      return source
  }
}
