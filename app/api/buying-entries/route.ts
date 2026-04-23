import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import Container from '@/models/Container'
import Product from '@/models/Product'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'
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
    const [rawEntries, total] = await Promise.all([
      BuyingEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .populate('product', 'productName')
        .populate('containerId', 'containerId containerName status'),
      BuyingEntry.countDocuments(filter),
    ])

    const entryIds = (rawEntries as { _id: mongoose.Types.ObjectId; inTransitCtn?: number }[])
      .filter((e) => (e.inTransitCtn ?? 0) > 0)
      .map((e) => e._id)
    const containersByEntry = new Map<string, { _id: string; containerId: string; containerName: string; status: string; ctnCount: number }[]>()
    if (entryIds.length > 0) {
      const containers = await Container.find({
        'entries.buyingEntry': { $in: entryIds },
      })
        .select('_id containerId containerName status entries.buyingEntry entries.ctnCount')
        .lean()
      for (const c of containers as { _id: mongoose.Types.ObjectId; containerId: string; containerName: string; status: string; entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]) {
        for (const ent of c.entries) {
          const id = ent.buyingEntry.toString()
          const list = containersByEntry.get(id) ?? []
          list.push({
            _id: c._id.toString(),
            containerId: c.containerId,
            containerName: c.containerName,
            status: c.status,
            ctnCount: ent.ctnCount ?? 0,
          })
          containersByEntry.set(id, list)
        }
      }
    }

    const entries = (rawEntries as { _id: mongoose.Types.ObjectId; inTransitCtn?: number; [k: string]: unknown }[]).map((e) => {
      const inTransit = e.inTransitCtn ?? 0
      if (inTransit <= 0) return e
      const containers = containersByEntry.get(e._id.toString()) ?? []
      const totalLoaded = containers.reduce((s, c) => s + c.ctnCount, 0)
      return { ...e, containers, unassignedCtn: inTransit - totalLoaded }
    })

    return NextResponse.json({
      success: true,
      data: {
        entries,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    })
  } catch (error) {
    console.error('Buying entries list API Error:', error)
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
  totalCtn: (v: unknown) => typeof v === 'number' && v >= 0,
  qty: (v: unknown) => typeof v === 'number' && v >= 0,
  rate: (v: unknown) => typeof v === 'number' && v >= 0,
  cbm: (v: unknown) => typeof v === 'number' && v >= 0,
  weight: (v: unknown) => typeof v === 'number' && v >= 0,
  carryingRate: (v: unknown) => v == null || (typeof v === 'number' && v >= 0),
  avgRmbRate: (v: unknown) => v == null || (typeof v === 'number' && v >= 0),
  entryDate: (v: unknown) => v != null,
  chinaWarehouseReceived: (v: unknown) =>
    v == null || ['yes', 'no'].includes(String(v)),
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
    if (!entrySchema.product(body.product) || !entrySchema.totalCtn(body.totalCtn) || !entrySchema.qty(body.qty) || !entrySchema.rate(body.rate) || !entrySchema.cbm(body.cbm) || !entrySchema.weight(body.weight) || !entrySchema.entryDate(body.entryDate)) {
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
    const advanceChinaPersonId =
      body.advanceChinaPerson != null && mongoose.Types.ObjectId.isValid(String(body.advanceChinaPerson))
        ? body.advanceChinaPerson
        : undefined

    const mark = typeof body.mark === 'string' && body.mark.trim().length > 0 ? body.mark.trim() : null
    if (!mark) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Mark is required' },
        { status: 400 }
      )
    }

    const chinaWarehouseReceived: 'yes' | 'no' =
      body.chinaWarehouseReceived === 'yes' ? 'yes' : 'no'
    const totalCtn = Number(body.totalCtn)
    const chinaWarehouseCtnRaw =
      chinaWarehouseReceived === 'yes' ? Number(body.chinaWarehouseCtn ?? 0) : totalCtn
    const inTransitCtnRaw =
      chinaWarehouseReceived === 'yes' ? Number(body.inTransitCtn ?? 0) : 0

    if (chinaWarehouseCtnRaw < 0 || inTransitCtnRaw < 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'China or In Transit CTN cannot be negative' },
        { status: 400 }
      )
    }
    if (chinaWarehouseCtnRaw + inTransitCtnRaw > totalCtn) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'China + In Transit CTN cannot exceed Total CTN' },
        { status: 400 }
      )
    }

    const initialAvailableCtn = Math.max(0, totalCtn - chinaWarehouseCtnRaw - inTransitCtnRaw)

    const entry = await BuyingEntry.create({
      product: body.product,
      mark,
      totalCtn,
      qty: body.qty,
      rate: body.rate,
      cbm: body.cbm,
      weight: body.weight,
      givenAmount: advanceAmt ?? 0,
      hasAdvancePayment: hasAdvance,
      advanceAmount: advanceAmt,
      advanceChinaPerson: advanceChinaPersonId,
      advanceDate: body.advanceDate != null && body.advanceDate !== '' ? new Date(body.advanceDate) : undefined,
      advanceNote: body.advanceNote != null && body.advanceNote !== '' ? String(body.advanceNote) : undefined,
      carryingRate: body.carryingRate,
      avgRmbRate: body.avgRmbRate,
      entryDate: new Date(body.entryDate),
      chinaWarehouseReceived,
      chinaWarehouseCtn: chinaWarehouseCtnRaw,
      inTransitCtn: inTransitCtnRaw,
      createdBy,
      updatedBy: createdBy,
      totalQty: 0,
      totalCbm: 0,
      totalWeight: 0,
      totalAmount: 0,
      remainingAmount: 0,
      totalCarrying: 0,
      totalExpenseINR: 0,
      perPisShipping: 0,
      rmbInrPurchase: 0,
      finalCost: 0,
      availableCtn: initialAvailableCtn,
      isLocked: false,
    })

    await entry.save()

    if (hasAdvance && advanceAmt != null && advanceAmt > 0 && advanceChinaPersonId) {
      const product = await Product.findById(body.product).select('productName').lean()
      const productName = product?.productName ?? 'Product'
      const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
      const sourceLabel = `Advance for ${productName} - ${entryDateStr}`

      const updatedPerson = await ChinaPerson.findByIdAndUpdate(
        advanceChinaPersonId,
        { $inc: { currentBalance: -Number(advanceAmt) }, updatedBy: createdBy },
        { new: true, select: 'currentBalance' }
      )
      const balanceAfter =
        (updatedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

      await ChinaPersonTransaction.create({
        chinaPerson: advanceChinaPersonId,
        type: 'pay_out',
        amount: advanceAmt,
        balanceAfter,
        transactionDate: entry.advanceDate ?? new Date(),
        notes: entry.advanceNote,
        sourceLabel,
        createdBy,
      })
    }

    const populated = await BuyingEntry.findById(entry._id).lean().populate('product', 'productName')
    return NextResponse.json({ success: true, data: populated })
  } catch (error) {
    console.error('Buying entry create API Error:', error)
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
