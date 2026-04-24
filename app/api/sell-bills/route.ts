import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import Company from '@/models/Company'
import { getNextBillNumber } from '@/models/Counter'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import { calcGrandTotal } from '@/lib/utils'
import { processFIFO } from '@/lib/fifo'
import { processIndiaFIFO } from '@/lib/india-fifo'
import mongoose from 'mongoose'

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
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const companyId = searchParams.get('companyId')?.trim()
    const startDate = searchParams.get('startDate')?.trim()
    const endDate = searchParams.get('endDate')?.trim()
    const search = searchParams.get('search')?.trim()

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (companyId === 'cashbook') {
      filter.isCashbook = true
    } else if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      filter.company = new mongoose.Types.ObjectId(companyId)
    }
    if (startDate || endDate) {
      filter.billDate = {}
      if (startDate) (filter.billDate as Record<string, Date>).$gte = new Date(startDate)
      if (endDate) (filter.billDate as Record<string, Date>).$lte = new Date(endDate)
    }
    if (search) {
      const searchNum = parseInt(search, 10)
      if (!Number.isNaN(searchNum)) {
        filter.billNumber = searchNum
      } else if (/\bcashbook\b/i.test(search)) {
        filter.isCashbook = true
      } else {
        const companies = await Company.find({ companyName: new RegExp(search, 'i') }).select('_id').lean()
        const ids = companies.map((c) => c._id)
        if (ids.length) filter.company = { $in: ids }
        else filter.company = { $in: [] }
      }
    }

    const skip = (page - 1) * limit
    const [billsRaw, total] = await Promise.all([
      SellBill.aggregate([
        { $match: filter },
        { $sort: { billDate: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $lookup: { from: 'companies', localField: 'company', foreignField: '_id', as: 'companyDoc' } },
        { $unwind: { path: '$companyDoc', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'sellbillitems', localField: '_id', foreignField: 'sellBill', as: 'itemList' } },
        {
          $addFields: {
            itemCount: { $size: '$itemList' },
            companyName: {
              $cond: [
                { $eq: ['$isCashbook', true] },
                'Cashbook',
                '$companyDoc.companyName',
              ],
            },
          },
        },
        { $project: { _id: 1, billNumber: 1, billDate: 1, company: 1, isCashbook: 1, companyName: 1, contact1Mobile: '$companyDoc.contact1Mobile', contact2Mobile: '$companyDoc.contact2Mobile', totalAmount: 1, grandTotal: 1, extraCharges: 1, discount: 1, whatsappSent: 1, whatsappSentAt: 1, itemCount: 1, itemList: 1 } },
      ]),
      SellBill.countDocuments(filter),
    ])

    const billIds = billsRaw.map((b) => b._id)
    const itemsWithProduct = await SellBillItem.find({ sellBill: { $in: billIds } })
      .populate('product', 'productName')
      .populate('indiaProduct', 'productName')
      .select('sellBill product indiaProduct ctnSold pcsSold')
      .lean()
    const itemsByBill = new Map<string | mongoose.Types.ObjectId, { productName: string; ctnSold: number; pcsSold: number }[]>()
    for (const item of itemsWithProduct) {
      const bid = String(item.sellBill)
      if (!itemsByBill.has(bid)) itemsByBill.set(bid, [])
      const productName = (item.product as { productName?: string })?.productName ?? (item.indiaProduct as { productName?: string })?.productName ?? '—'
      itemsByBill.get(bid)!.push({ productName, ctnSold: item.ctnSold, pcsSold: item.pcsSold })
    }

    const formatCtnPcs = (ctn: number, pcs: number): string => {
      const isWhole = Number.isInteger(ctn)
      return isWhole ? `${ctn} CTN (${pcs} pcs)` : `${ctn.toFixed(2)} CTN (${pcs} pcs)`
    }

    const list = billsRaw.map((b) => {
      const items = itemsByBill.get(String(b._id)) ?? []
      return {
        _id: b._id,
        billNumber: b.billNumber,
        billDate: b.billDate,
        company: b.company,
        isCashbook: !!b.isCashbook,
        companyName: b.companyName ?? '—',
        contact1Mobile: b.contact1Mobile,
        contact2Mobile: b.contact2Mobile,
        totalAmount: b.totalAmount,
        grandTotal: b.grandTotal ?? b.totalAmount,
        whatsappSent: b.whatsappSent ?? false,
        whatsappSentAt: b.whatsappSentAt,
        itemCount: b.itemCount ?? 0,
        productsSummary: items.map((i) => `${i.productName}: ${formatCtnPcs(i.ctnSold, i.pcsSold)}`).join('\n') || (b.itemCount != null ? `${b.itemCount} product${b.itemCount !== 1 ? 's' : ''}` : '—'),
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        bills: list,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    })
  } catch (error) {
    console.error('Sell bills list API Error:', error)
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

const itemSchema = {
  productSource: (v: unknown) => v === 'china' || v === 'india',
  productId: (v: unknown) => v != null && typeof v === 'string' && mongoose.Types.ObjectId.isValid(v),
  pcs: (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0,
  ratePerPcs: (v: unknown) => typeof v === 'number' && v >= 0,
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
    const companyId = body.companyId
    const billDate = body.billDate
    const items: { productSource: 'china' | 'india'; productId: string; pcs: number; ratePerPcs: number }[] = Array.isArray(body.items) ? body.items : []
    const notes = body.notes
    const extraCharges = Number(body.extraCharges) || 0
    const extraChargesNote = body.extraChargesNote != null ? String(body.extraChargesNote).trim() : ''
    const discount = Number(body.discount) || 0
    const discountNote = body.discountNote != null ? String(body.discountNote).trim() : ''

    const isCashbook = companyId === 'cashbook'
    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Select company or Cashbook' },
        { status: 400 }
      )
    }
    if (!isCashbook && !mongoose.Types.ObjectId.isValid(companyId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Valid company is required' },
        { status: 400 }
      )
    }
    if (!billDate) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Bill date is required' },
        { status: 400 }
      )
    }
    if (!items.length || items.some((i: { productSource?: unknown; productId?: unknown; pcs?: unknown; ratePerPcs?: unknown }) => !itemSchema.productSource(i.productSource) || !itemSchema.productId(i.productId) || !itemSchema.pcs(i.pcs) || !itemSchema.ratePerPcs(i.ratePerPcs))) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'At least one valid line item (source, product, PCS > 0, rate) is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const billNumber = await getNextBillNumber()

    const bill = await SellBill.create({
      billNumber,
      company: isCashbook ? null : new mongoose.Types.ObjectId(companyId),
      isCashbook: !!isCashbook,
      companyName: isCashbook ? 'Cashbook' : null,
      billDate: new Date(billDate),
      items: [],
      totalAmount: 0,
      extraCharges,
      extraChargesNote: extraChargesNote || undefined,
      discount,
      discountNote: discountNote || undefined,
      grandTotal: 0,
      notes: notes != null && String(notes).trim() !== '' ? String(notes).trim() : undefined,
      whatsappSent: false,
      createdBy,
      updatedBy: createdBy,
    })

    const createdItems: mongoose.Types.ObjectId[] = []
    let totalAmount = 0

    for (const row of items) {
      const productId = new mongoose.Types.ObjectId(row.productId)
      const isIndia = row.productSource === 'india'
      const { fifoBreakdown, fifoNote, totalProfit, pcsSold } = isIndia
        ? await processIndiaFIFO(productId, row.pcs, row.ratePerPcs)
        : await processFIFO(productId, row.pcs, row.ratePerPcs)
      const ctnSold = fifoBreakdown.reduce((s, b) => s + b.ctnConsumed, 0)
      const lineTotal = pcsSold * row.ratePerPcs
      totalAmount += lineTotal

      const item = await SellBillItem.create({
        sellBill: bill._id,
        productSource: row.productSource,
        product: isIndia ? undefined : productId,
        indiaProduct: isIndia ? productId : undefined,
        ctnSold: parseFloat(ctnSold.toFixed(4)),
        pcsSold,
        ratePerPcs: row.ratePerPcs,
        totalAmount: lineTotal,
        fifoBreakdown,
        fifoNote,
        totalProfit,
        createdBy,
        updatedBy: createdBy,
      })
      createdItems.push(item._id as mongoose.Types.ObjectId)
    }

    const subtotal = Math.round(totalAmount * 100) / 100
    const grandTotal = calcGrandTotal(subtotal, extraCharges, discount)
    await SellBill.findByIdAndUpdate(bill._id, {
      items: createdItems,
      totalAmount: subtotal,
      extraCharges,
      extraChargesNote: extraChargesNote || undefined,
      discount,
      discountNote: discountNote || undefined,
      grandTotal,
    })

    if (isCashbook) {
      await createCashTransaction({
        type: 'credit',
        amount: grandTotal,
        description: `Cashbook sale — Bill #${bill.billNumber}`,
        date: new Date(billDate),
        category: 'cashbook_sale',
        referenceId: bill._id as mongoose.Types.ObjectId,
        referenceType: 'SellBill',
      })
    } else {
      await Company.findByIdAndUpdate(companyId, {
        $inc: { outstanding: grandTotal },
      })
    }

    const populated = await SellBill.findById(bill._id)
      .lean()
      .populate('company', 'companyName ownerName contact1Mobile contact2Mobile')
      .populate({ path: 'items', populate: { path: 'product', select: 'productName' } })

    return NextResponse.json({ success: true, data: populated })
  } catch (error) {
    console.error('Sell bill create API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error && error.message.includes('Insufficient stock') ? 'Validation failed' : 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: error instanceof Error && error.message.includes('Insufficient stock') ? 400 : 500 }
    )
  }
}
