import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import BuyingPayment from '@/models/BuyingPayment'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

type TxType = 'pay_in' | 'pay_out'

type LeanTx = {
  _id: mongoose.Types.ObjectId
  chinaPerson: mongoose.Types.ObjectId
  type: TxType
  amount: number
  balanceAfter?: number
  transactionDate: Date
  notes?: string
  sourceLabel?: string
  buyingPayment?: mongoose.Types.ObjectId
  isReversal?: boolean
  sortOrder?: number
  createdAt: Date
  updatedAt: Date
}

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
        { success: false, error: 'Validation failed', message: 'Invalid person id' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()
    const exportAll = searchParams.get('exportAll') === '1'

    await connectDB()

    const personId = new mongoose.Types.ObjectId(id)
    const person = await ChinaPerson.findById(personId).lean()
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }

    const filter: Record<string, unknown> = { chinaPerson: personId }
    if (startDate || endDate) {
      filter.transactionDate = {}
      if (startDate) (filter.transactionDate as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(filter.transactionDate as Record<string, Date>).$lte = end
      }
    }

    // Timeline order (oldest -> newest): use full transactionDate (time included) + stable tie-breakers.
    const timelineAsc = (await ChinaPersonTransaction.find(filter)
      .sort({ transactionDate: 1, sortOrder: 1, createdAt: 1, _id: 1 })
      .lean()) as LeanTx[]

    const totalFiltered = timelineAsc.length

    // Build a deterministic balanceAfter chain using the earliest transaction's stored balanceAfter as anchor.
    // That keeps the response consistent for the UI even if older records were created out-of-order.
    let runningBalance = 0
    if (timelineAsc.length > 0) {
      const first = timelineAsc[0]
      const firstDelta = first.type === 'pay_in' ? first.amount : -first.amount
      const firstBalanceAfter = first.balanceAfter ?? 0
      // balanceAfter = balanceBefore + firstDelta => balanceBefore = balanceAfter - delta
      runningBalance = firstBalanceAfter - firstDelta
    } else {
      runningBalance = person.currentBalance ?? 0
    }

    const computedAsc = timelineAsc.map((t) => {
      const delta = t.type === 'pay_in' ? t.amount : -t.amount
      runningBalance += delta
      const sourceLabel = t.sourceLabel ?? ''
      const notes = t.notes ?? ''
      const looksLikeReversal = /^Reversal\b/i.test(sourceLabel) || /\bReversal\b/i.test(notes)
      const isReversal = t.isReversal === true || looksLikeReversal

      return {
        ...t,
        balanceAfter: runningBalance,
        isReversal,
      }
    })

    const computedDesc = computedAsc.slice().reverse()
    const selected = exportAll
      ? computedDesc
      : computedDesc.slice((page - 1) * limit, page * limit)

    const paymentIds = selected
      .map((t) => t.buyingPayment)
      .filter((pid): pid is mongoose.Types.ObjectId => pid != null)

    const paymentMeta = new Map<
      string,
      { productId: string; productName: string; entryDate: string }
    >()
    if (paymentIds.length > 0) {
      const payments = await BuyingPayment.find({ _id: { $in: paymentIds } })
        .populate('product', 'productName')
        .populate('buyingEntry', 'entryDate')
        .lean()

      for (const p of payments) {
        const product = p.product as { _id: mongoose.Types.ObjectId; productName?: string } | null
        const entry = p.buyingEntry as { entryDate?: Date } | null
        paymentMeta.set(String(p._id), {
          productId: product ? String(product._id) : '',
          productName: product?.productName ?? '—',
          entryDate: entry?.entryDate ? entry.entryDate.toISOString() : '',
        })
      }
    }

    const computedCurrentBalance =
      computedAsc.length > 0
        ? computedAsc[computedAsc.length - 1].balanceAfter ?? 0
        : person.currentBalance ?? 0

    return NextResponse.json({
      success: true,
      data: {
        person: {
          _id: person._id,
          name: person.name,
          isDefault: person.isDefault,
          currentBalance: computedCurrentBalance,
        },
        transactions: selected.map((t) => {
          const meta = t.buyingPayment ? paymentMeta.get(String(t.buyingPayment)) : undefined
          return {
            _id: t._id,
            type: t.type,
            amount: t.amount,
            balanceAfter: t.balanceAfter ?? 0,
            transactionDate: t.transactionDate,
            notes: t.notes,
            sourceLabel: t.sourceLabel,
            productId: meta?.productId,
            productName: meta?.productName,
            entryDate: meta?.entryDate,
            isReversal: t.isReversal,
          }
        }),
        pagination: {
          page,
          limit,
          total: totalFiltered,
          pages: Math.ceil(totalFiltered / limit),
        },
      },
    })
  } catch (error) {
    console.error('Sophia transactions API Error:', error)
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
