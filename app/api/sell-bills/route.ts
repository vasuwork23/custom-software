import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import Company from '@/models/Company'
import {
  createSellBill,
  validateSellBillInput,
  formatCtnPcs,
  type CreateSellBillInput,
} from '@/lib/create-sell-bill'
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
        { $lookup: { from: 'bankaccounts', localField: 'bankAccount', foreignField: '_id', as: 'bankAccountDoc' } },
        { $unwind: { path: '$bankAccountDoc', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'sellbillitems', localField: '_id', foreignField: 'sellBill', as: 'itemList' } },
        {
          $addFields: {
            itemCount: { $size: '$itemList' },
            companyName: {
              $cond: [
                '$company',
                '$companyDoc.companyName',
                {
                  $cond: [
                    '$isBankSale',
                    { $ifNull: ['$bankAccountDoc.accountName', '$companyName'] },
                    { $ifNull: ['$companyName', '—'] },
                  ],
                },
              ],
            },
          },
        },
        { $project: { _id: 1, billNumber: 1, billDate: 1, company: 1, isCashbook: 1, isBankSale: 1, bankAccount: 1, companyName: 1, contact1Mobile: '$companyDoc.contact1Mobile', contact2Mobile: '$companyDoc.contact2Mobile', totalAmount: 1, grandTotal: 1, extraCharges: 1, discount: 1, whatsappSent: 1, whatsappSentAt: 1, itemCount: 1, itemList: 1 } },
      ]),
      SellBill.countDocuments(filter),
    ])

    const billIds = billsRaw.map((b) => b._id)
    const itemsWithProduct = await SellBillItem.find({ sellBill: { $in: billIds } })
      .populate('product', 'productName')
      .populate('indiaProduct', 'productName')
      .select('sellBill product indiaProduct ctnSold pcsSold ratePerPcs')
      .lean()
    const itemsByBill = new Map<string | mongoose.Types.ObjectId, { productName: string; ctnSold: number; pcsSold: number; ratePerPcs: number }[]>()
    for (const item of itemsWithProduct) {
      const bid = String(item.sellBill)
      if (!itemsByBill.has(bid)) itemsByBill.set(bid, [])
      const productName = (item.product as { productName?: string })?.productName ?? (item.indiaProduct as { productName?: string })?.productName ?? '—'
      itemsByBill.get(bid)!.push({ productName, ctnSold: item.ctnSold, pcsSold: item.pcsSold, ratePerPcs: item.ratePerPcs })
    }

    const list = billsRaw.map((b) => {
      const items = itemsByBill.get(String(b._id)) ?? []
      return {
        _id: b._id,
        billNumber: b.billNumber,
        billDate: b.billDate,
        company: b.company,
        isCashbook: !!b.isCashbook,
        isBankSale: !!b.isBankSale,
        bankAccount: b.bankAccount,
        companyName: b.companyName ?? '—',
        contact1Mobile: b.contact1Mobile,
        contact2Mobile: b.contact2Mobile,
        totalAmount: b.totalAmount,
        grandTotal: b.grandTotal ?? b.totalAmount,
        whatsappSent: b.whatsappSent ?? false,
        whatsappSentAt: b.whatsappSentAt,
        itemCount: b.itemCount ?? 0,
        productsSummary: items.map((i) => `${i.productName}: ${formatCtnPcs(i.ctnSold, i.pcsSold)} @₹${i.ratePerPcs}`).join('\n') || (b.itemCount != null ? `${b.itemCount} product${b.itemCount !== 1 ? 's' : ''}` : '—'),
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
    const input: CreateSellBillInput = {
      companyId: body.companyId,
      bankAccountId: body.bankAccountId,
      billDate: body.billDate,
      items: Array.isArray(body.items) ? body.items : [],
      notes: body.notes,
      extraCharges: body.extraCharges,
      extraChargesNote: body.extraChargesNote,
      discount: body.discount,
      discountNote: body.discountNote,
    }

    const validationError = validateSellBillInput(input)
    if (validationError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: validationError },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    const { billId } = await createSellBill(input, createdBy)

    const populated = await SellBill.findById(billId)
      .lean()
      .populate('company', 'companyName ownerName contact1Mobile contact2Mobile')
      .populate({ path: 'items', populate: { path: 'product', select: 'productName' } })

    return NextResponse.json({ success: true, data: populated })
  } catch (error) {
    console.error('Sell bill create API Error:', error)
    const isStockError = error instanceof Error && error.message.includes('Insufficient stock')
    return NextResponse.json(
      {
        success: false,
        error: isStockError ? 'Validation failed' : 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: isStockError ? 400 : 500 }
    )
  }
}
