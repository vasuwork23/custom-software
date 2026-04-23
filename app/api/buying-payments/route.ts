import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import BuyingPayment from '@/models/BuyingPayment'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'
import { recalcBuyingEntryGivenAndStatus } from '@/lib/buying-entry-payments'
import { format } from 'date-fns'

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
    const buyingEntryId = searchParams.get('buyingEntryId')
    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const payments = await BuyingPayment.find({ buyingEntry: buyingEntryId })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean()
      .populate('chinaPerson', 'name')

    const list = payments.map((p) => ({
      _id: p._id,
      buyingEntry: p.buyingEntry,
      product: p.product,
      chinaPerson: p.chinaPerson,
      chinaPersonName: (p.chinaPerson as { name?: string })?.name,
      amount: p.amount,
      paymentDate: p.paymentDate,
      notes: p.notes,
    }))

    return NextResponse.json({ success: true, data: { payments: list } })
  } catch (error) {
    console.error('Buying payments list API Error:', error)
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
    const buyingEntryId = body.buyingEntryId ?? body.buyingEntry
    const productId = body.productId ?? body.product
    const chinaPersonId = body.chinaPersonId ?? body.chinaPerson
    const amount = Number(body.amount)
    const paymentDateRaw = body.paymentDate
    const notes =
      body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : undefined

    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId is required' },
        { status: 400 }
      )
    }
    if (productId && !mongoose.Types.ObjectId.isValid(productId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid productId' },
        { status: 400 }
      )
    }
    if (!chinaPersonId || !mongoose.Types.ObjectId.isValid(chinaPersonId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'chinaPersonId is required' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Amount must be a positive number (RMB)',
        },
        { status: 400 }
      )
    }
    const paymentDate = paymentDateRaw ? new Date(paymentDateRaw) : new Date()
    if (Number.isNaN(paymentDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid payment date' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    const entry = await BuyingEntry.findById(buyingEntryId)
      .populate('product', 'productName')
      .lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }
    const remainingFromDb = entry.remainingAmount ?? 0
    if (amount > remainingFromDb) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Payment amount ¥${amount} exceeds remaining balance of ¥${remainingFromDb}`,
        },
        { status: 400 }
      )
    }

    const person = await ChinaPerson.findById(chinaPersonId)
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }

    const entryProductId = (entry.product as { _id?: mongoose.Types.ObjectId })?._id ?? entry.product
    if (productId && String(entryProductId) !== String(productId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Product does not match buying entry' },
        { status: 400 }
      )
    }

    const productName = (entry.product as { productName?: string })?.productName ?? 'Product'
    const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
    const sourceLabel = `Payment for ${productName} - ${entryDateStr}`

    const payment = await BuyingPayment.create({
      buyingEntry: buyingEntryId,
      product: entryProductId,
      chinaPerson: chinaPersonId,
      amount,
      paymentDate,
      notes,
      createdBy,
    })

    const updatedPerson = await ChinaPerson.findByIdAndUpdate(
      chinaPersonId,
      { $inc: { currentBalance: -Number(amount) }, updatedBy: createdBy },
      { new: true, select: 'currentBalance' }
    )
    const balanceAfter =
      (updatedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

    await ChinaPersonTransaction.create({
      chinaPerson: chinaPersonId,
      type: 'pay_out',
      amount,
      balanceAfter,
      transactionDate: paymentDate,
      notes,
      sourceLabel,
      buyingPayment: payment._id,
      createdBy,
    })

    await recalcBuyingEntryGivenAndStatus(new mongoose.Types.ObjectId(buyingEntryId))

    const payments = await BuyingPayment.find({ buyingEntry: buyingEntryId })
      .sort({ paymentDate: -1 })
      .lean()
      .populate('chinaPerson', 'name')
    return NextResponse.json({
      success: true,
      data: { payments, productName },
    })
  } catch (error) {
    console.error('Buying payment create API Error:', error)
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
