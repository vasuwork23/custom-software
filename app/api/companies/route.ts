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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const search = searchParams.get('search')?.trim() ?? ''
    const outstandingFilterParam = searchParams.get('outstandingFilter')?.trim() ?? 'all'
    const outstandingFilter = ['all', 'positive', 'negative', 'clear'].includes(outstandingFilterParam)
      ? outstandingFilterParam
      : 'all'
    const minOutstandingRaw = searchParams.get('minOutstanding')?.trim() ?? ''
    const maxOutstandingRaw = searchParams.get('maxOutstanding')?.trim() ?? ''
    const minOutstanding =
      minOutstandingRaw !== '' &&
      Number.isFinite(Number(minOutstandingRaw)) &&
      Number(minOutstandingRaw) >= 0
        ? Number(minOutstandingRaw)
        : null
    const maxOutstanding =
      maxOutstandingRaw !== '' &&
      Number.isFinite(Number(maxOutstandingRaw)) &&
      Number(maxOutstandingRaw) >= 0
        ? Number(maxOutstandingRaw)
        : null

    // Floating point safety for "clear" filter (0 outstanding).
    const epsilon = 0.00001

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

    // 1) Get candidate companies for the search filter.
    // We compute outstanding for these candidates server-side, then apply outstanding filters and pagination.
    const allCompanies = await Company.find(filter).sort({ companyName: 1 }).lean()
    if (allCompanies.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          companies: [],
          pagination: { page, limit, total: 0, pages: 0 },
          totals: { totalPositiveOutstanding: 0, totalNegativeOutstanding: 0 },
        },
      })
    }

    const companyIds = allCompanies.map((c) => c._id)

    // 2) Compute billed/received totals to derive outstanding.
    const [billedAgg, receivedAgg] = await Promise.all([
      SellBill.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
      ]),
      PaymentReceipt.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: '$amount' } } },
      ]),
    ])

    const billedByCompany = Object.fromEntries(billedAgg.map((r) => [String(r._id), r.total]))
    const receivedByCompany = Object.fromEntries(receivedAgg.map((r) => [String(r._id), r.total]))

    const enriched = allCompanies.map((c) => {
      const totalBilled = billedByCompany[String(c._id)] ?? 0
      const totalReceived = receivedByCompany[String(c._id)] ?? 0
      const outstandingBalance = totalBilled - totalReceived + (c.openingBalance || 0)
      return {
        ...c,
        outstandingBalance,
      }
    })

    // 3) Apply outstanding filters and outstanding amount range.
    // Range filters use absolute outstanding value so it works for both positive/negative.
    const filtered = enriched.filter((c) => {
      const outstanding = c.outstandingBalance as number
      const absOutstanding = Math.abs(outstanding)

      const statusMatch =
        outstandingFilter === 'all'
          ? true
          : outstandingFilter === 'positive'
          ? outstanding > epsilon
          : outstandingFilter === 'negative'
          ? outstanding < -epsilon
          : Math.abs(outstanding) <= epsilon

      if (!statusMatch) return false

      if (minOutstanding != null && Number.isFinite(minOutstanding) && absOutstanding < minOutstanding) {
        return false
      }
      if (maxOutstanding != null && Number.isFinite(maxOutstanding) && absOutstanding > maxOutstanding) {
        return false
      }

      return true
    })

    const totalPositiveOutstanding = filtered
      .filter((c) => (c.outstandingBalance as number) > epsilon)
      .reduce((sum, c) => sum + (c.outstandingBalance as number), 0)

    const totalNegativeOutstanding = filtered
      .filter((c) => (c.outstandingBalance as number) < -epsilon)
      .reduce((sum, c) => sum + Math.abs(c.outstandingBalance as number), 0)

    // 4) Paginate after applying outstanding filters.
    const total = filtered.length
    const pages = Math.ceil(total / limit)
    const pageCompanies = filtered.slice(skip, skip + limit)

    const pageCompanyIds = pageCompanies.map((c) => c._id)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    let profitByCompany: Record<string, number> = {}
    let last7DaysSalesByCompany: Record<string, number> = {}
    if (pageCompanyIds.length > 0) {
      const [profitAgg, salesAgg] = await Promise.all([
        SellBillItem.aggregate([
          { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
          { $unwind: '$bill' },
          { $match: { 'bill.company': { $in: pageCompanyIds } } },
          { $group: { _id: '$bill.company', total: { $sum: '$totalProfit' } } },
        ]),
        SellBill.aggregate([
          { $match: { company: { $in: pageCompanyIds }, createdAt: { $gte: sevenDaysAgo } } },
          { $group: { _id: '$company', total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
        ]),
      ])
      profitByCompany = Object.fromEntries(profitAgg.map((r) => [String(r._id), r.total]))
      last7DaysSalesByCompany = Object.fromEntries(salesAgg.map((r) => [String(r._id), r.total]))
    }

    const list = pageCompanies.map((c) => {
      const totalProfit = profitByCompany[String(c._id)] ?? 0
      const last7DaysSales = last7DaysSalesByCompany[String(c._id)] ?? 0
      const outstanding = c.outstandingBalance as number
      const showAlert = outstanding > 0 && outstanding > last7DaysSales
      return {
        ...c,
        totalProfit,
        showAlert,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        companies: list,
        pagination: { page, limit, total, pages },
        totals: { totalPositiveOutstanding, totalNegativeOutstanding },
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
  openingBalance: (v: unknown) => v == null || typeof v === 'number',
  openingBalanceNotes: (v: unknown) => v == null || typeof v === 'string',
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
      openingBalance: typeof body.openingBalance === 'number' ? body.openingBalance : 0,
      openingBalanceNotes:
        body.openingBalanceNotes != null && body.openingBalanceNotes !== ''
          ? String(body.openingBalanceNotes).trim()
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
