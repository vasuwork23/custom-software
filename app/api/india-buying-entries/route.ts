import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaProduct from '@/models/IndiaProduct'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'
import { format } from 'date-fns'
import { recalcIndiaBuyingEntryGivenAndStatus } from '@/lib/india-buying-entry-payments'

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
    const productId = searchParams.get('productId')
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const status = searchParams.get('status')

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'productId is required' },
        { status: 400 }
      )
    }

    await connectDB()

    const filter: Record<string, unknown> = { product: new mongoose.Types.ObjectId(productId) }
    if (status) filter.currentStatus = status

    const skip = (page - 1) * limit
    const [entries, total] = await Promise.all([
      IndiaBuyingEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().populate('product', 'productName'),
      IndiaBuyingEntry.countDocuments(filter),
    ])

    return NextResponse.json({
      success: true,
      data: {
        entries,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    })
  } catch (error) {
    console.error('India buying entries list API Error:', error)
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

const entrySchema = {
  product: (v: unknown) => v != null && mongoose.Types.ObjectId.isValid(String(v)),
  totalCtn: (v: unknown) => typeof v === 'number' && v > 0,
  qty: (v: unknown) => typeof v === 'number' && v > 0,
  rate: (v: unknown) => typeof v === 'number' && v >= 0,
  entryDate: (v: unknown) => v != null,
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const body = await req.json()
    if (
      !entrySchema.product(body.product) ||
      !entrySchema.totalCtn(body.totalCtn) ||
      !entrySchema.qty(body.qty) ||
      !entrySchema.rate(body.rate) ||
      !entrySchema.entryDate(body.entryDate)
    ) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Missing or invalid required fields' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    const hasAdvance = body.hasAdvancePayment ?? false
    const advanceAmt =
      hasAdvance && body.advanceAmount != null && body.advanceAmount !== ''
        ? Number(body.advanceAmount)
        : undefined
    const advanceBankId =
      body.advanceBankAccount != null && mongoose.Types.ObjectId.isValid(String(body.advanceBankAccount))
        ? body.advanceBankAccount
        : undefined

    const calculatedTotalAmount = Math.round(Number(body.totalCtn) * Number(body.qty) * Number(body.rate))

    if (hasAdvance && (advanceAmt ?? 0) > 0) {
      if (!advanceBankId) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            message: 'Please select a bank account for the advance payment',
          },
          { status: 400 }
        )
      }
    }

    const entry = await IndiaBuyingEntry.create({
      product: body.product,
      totalCtn: body.totalCtn,
      qty: body.qty,
      rate: body.rate,
      entryDate: new Date(body.entryDate),
      totalQty: 0,
      totalAmount: 0,
      finalCost: body.rate,
      givenAmount: advanceAmt ?? 0,
      remainingAmount: 0,
      hasAdvancePayment: hasAdvance,
      advanceAmount: advanceAmt,
      advanceBankAccount: advanceBankId,
      advanceDate: body.advanceDate != null && body.advanceDate !== '' ? new Date(body.advanceDate) : undefined,
      advanceNote: body.advanceNote != null && body.advanceNote !== '' ? String(body.advanceNote) : undefined,
      availableCtn: body.totalCtn,
      createdBy,
      updatedBy: createdBy,
    })

    await entry.save()

    if (hasAdvance && advanceAmt != null && advanceAmt > 0 && advanceBankId) {
      const product = await IndiaProduct.findById(body.product).select('productName').lean()
      const productName = product?.productName ?? 'India Product'
      const sourceLabel = `Advance for India Product: ${productName}`

      const bankAcct = await BankAccount.findById(advanceBankId).select('type').lean()
      const isCash = bankAcct?.type === 'cash'

      if (isCash) {
        const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
        await createCashTransaction({
          type: 'debit',
          amount: advanceAmt,
          description: sourceLabel + (entry.advanceNote ? ` - ${entry.advanceNote}` : ''),
          date: entry.advanceDate ?? new Date(),
          category: 'other',
          referenceId: entry._id as mongoose.Types.ObjectId,
          referenceType: 'india_buying_advance',
        })
      } else {
        const lastTx = await BankTransaction.findOne({ bankAccount: advanceBankId })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const newBalance = lastBalance - advanceAmt

        await BankTransaction.create({
          bankAccount: advanceBankId,
          type: 'debit',
          amount: advanceAmt,
          balanceAfter: newBalance,
          source: 'india_buying_advance',
          sourceRef: entry._id,
          sourceLabel,
          transactionDate: entry.advanceDate ?? new Date(),
          notes: entry.advanceNote,
          createdBy,
        })
        await BankAccount.findByIdAndUpdate(advanceBankId, { currentBalance: newBalance })
      }
    }

    const populated = await IndiaBuyingEntry.findById(entry._id).lean().populate('product', 'productName')
    return NextResponse.json({ success: true, data: populated })
  } catch (error) {
    console.error('India buying entry create API Error:', error)
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
