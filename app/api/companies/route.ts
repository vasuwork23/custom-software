import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import PaymentReceipt from '@/models/PaymentReceipt'

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
    const search = searchParams.get('search')?.trim() ?? ''

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (search) {
      filter.$or = [
        { companyName: new RegExp(search, 'i') },
        { ownerName: new RegExp(search, 'i') },
        { city: new RegExp(search, 'i') },
        { contact1Mobile: new RegExp(search, 'i') },
        { contact2Mobile: new RegExp(search, 'i') },
        { primaryMobile: new RegExp(search, 'i') },
      ]
    }

    const skip = (page - 1) * limit
    const [companies, total] = await Promise.all([
      Company.find(filter).sort({ companyName: 1 }).skip(skip).limit(limit).lean(),
      Company.countDocuments(filter),
    ])

    const companyIds = companies.map((c) => c._id)

    const [billedAgg, receivedAgg, profitAgg] = await Promise.all([
      SellBill.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
      ]),
      PaymentReceipt.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: '$amount' } } },
      ]),
      SellBillItem.aggregate([
        { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
        { $unwind: '$bill' },
        { $match: { 'bill.company': { $in: companyIds } } },
        { $group: { _id: '$bill.company', total: { $sum: '$totalProfit' } } },
      ]),
    ])

    const billedByCompany = Object.fromEntries(billedAgg.map((r) => [String(r._id), r.total]))
    const receivedByCompany = Object.fromEntries(receivedAgg.map((r) => [String(r._id), r.total]))
    const profitByCompany = Object.fromEntries(profitAgg.map((r) => [String(r._id), r.total]))

    const list = companies.map((c) => {
      const totalBilled = billedByCompany[String(c._id)] ?? 0
      const totalReceived = receivedByCompany[String(c._id)] ?? 0
      const totalProfit = profitByCompany[String(c._id)] ?? 0
      const outstandingBalance = totalBilled - totalReceived
      return {
        ...c,
        outstandingBalance,
        totalProfit,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        companies: list,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    })
  } catch (error) {
    console.error('Companies list API Error:', error)
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

const createSchema = {
  companyName: (v: unknown) => typeof v === 'string' && v.trim().length > 0,
  ownerName: (v: unknown) => v == null || typeof v === 'string',
  contact1Name: (v: unknown) => v == null || typeof v === 'string',
  contact1Mobile: (v: unknown) => v == null || typeof v === 'string',
  contact2Name: (v: unknown) => v == null || typeof v === 'string',
  contact2Mobile: (v: unknown) => v == null || typeof v === 'string',
  gstNumber: (v: unknown) => v == null || typeof v === 'string',
  address: (v: unknown) => v == null || typeof v === 'string',
  city: (v: unknown) => v == null || typeof v === 'string',
  primaryMobile: (v: unknown) => v == null || typeof v === 'string',
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
    if (!createSchema.companyName(body.companyName)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Company name is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const company = await Company.create({
      companyName: (body.companyName as string).trim(),
      ownerName:
        body.ownerName != null && body.ownerName !== ''
          ? String(body.ownerName).trim()
          : undefined,
      contact1Name:
        body.contact1Name != null && body.contact1Name !== ''
          ? String(body.contact1Name).trim()
          : undefined,
      contact1Mobile:
        body.contact1Mobile != null && body.contact1Mobile !== ''
          ? String(body.contact1Mobile).trim()
          : undefined,
      contact2Name:
        body.contact2Name != null && body.contact2Name !== ''
          ? String(body.contact2Name).trim()
          : undefined,
      contact2Mobile:
        body.contact2Mobile != null && body.contact2Mobile !== ''
          ? String(body.contact2Mobile).trim()
          : undefined,
      gstNumber:
        body.gstNumber != null && body.gstNumber !== ''
          ? String(body.gstNumber).trim()
          : undefined,
      address:
        body.address != null && body.address !== ''
          ? String(body.address).trim()
          : undefined,
      city:
        body.city != null && body.city !== ''
          ? String(body.city).trim()
          : undefined,
      primaryMobile:
        body.primaryMobile != null && body.primaryMobile !== ''
          ? String(body.primaryMobile).trim()
          : undefined,
      createdBy,
      updatedBy: createdBy,
    })

    const created = await Company.findById(company._id).lean()
    return NextResponse.json({ success: true, data: created })
  } catch (error) {
    console.error('Company create API Error:', error)
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
