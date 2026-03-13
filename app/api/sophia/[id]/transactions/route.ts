import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import BuyingPayment from '@/models/BuyingPayment'
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

    // Fetch ALL transactions for this person, oldest first by createdAt
    const filter: Record<string, unknown> = { chinaPerson: personId }
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) (filter.createdAt as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(filter.createdAt as Record<string, Date>).$lte = end
      }
    }

    const allTransactions = await ChinaPersonTransaction.find(filter)
      .sort({ createdAt: 1 })
      .lean()

    const forDisplay = [...allTransactions].reverse()
    const totalFiltered = allTransactions.length
    const paginated = exportAll
      ? forDisplay
      : forDisplay.slice((page - 1) * limit, page * limit)
    const transactions = paginated

    const paymentIds = transactions
      .map((t) => (t as { buyingPayment?: mongoose.Types.ObjectId }).buyingPayment)
      .filter((id): id is mongoose.Types.ObjectId => id != null)
    let paymentMeta = new Map<
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
          entryDate: entry?.entryDate
            ? new Date(entry.entryDate).toISOString()
            : '',
        })
      }
    }

    const list = transactions.map((t) => {
      const tx = t as {
        _id: mongoose.Types.ObjectId
        type: string
        amount: number
        balanceAfter?: number
        transactionDate: Date
        notes?: string
        sourceLabel?: string
        buyingPayment?: mongoose.Types.ObjectId
        isReversal?: boolean
      }
      const meta = tx.buyingPayment ? paymentMeta.get(String(tx.buyingPayment)) : null
      const sourceLabel = tx.sourceLabel ?? ''
      const notes = tx.notes ?? ''
      const looksLikeReversal = /^Reversal\b/i.test(sourceLabel) || /\bReversal\b/i.test(notes)
      const isReversal = tx.isReversal === true || looksLikeReversal
      return {
        _id: tx._id,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter ?? 0,
        transactionDate: tx.transactionDate,
        notes: tx.notes,
        sourceLabel: tx.sourceLabel,
        productId: meta?.productId,
        productName: meta?.productName,
        entryDate: meta?.entryDate,
        isReversal,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        person: {
          _id: person._id,
          name: person.name,
          isDefault: person.isDefault,
          currentBalance: person.currentBalance ?? 0,
        },
        transactions: list,
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
