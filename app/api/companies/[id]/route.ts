import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import PaymentReceipt from '@/models/PaymentReceipt'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

async function getOutstanding(companyId: mongoose.Types.ObjectId): Promise<{ totalBilled: number; totalReceived: number; outstanding: number }> {
  const [billedRes, receivedRes] = await Promise.all([
    SellBill.aggregate([
      { $match: { company: companyId } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
    ]),
    PaymentReceipt.aggregate([
      { $match: { company: companyId } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])
  const totalBilled = billedRes[0]?.total ?? 0
  const totalReceived = receivedRes[0]?.total ?? 0
  const outstanding = totalBilled - totalReceived
  return { totalBilled, totalReceived, outstanding }
}

async function getTotalProfit(companyId: mongoose.Types.ObjectId): Promise<number> {
  const res = await SellBillItem.aggregate([
    { $lookup: { from: 'sellbills', localField: 'sellBill', foreignField: '_id', as: 'bill' } },
    { $unwind: '$bill' },
    { $match: { 'bill.company': companyId } },
    { $group: { _id: null, total: { $sum: '$totalProfit' } } },
  ])
  return res[0]?.total ?? 0
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
        { success: false, error: 'Validation failed', message: 'Invalid company id' },
        { status: 400 }
      )
    }

    await connectDB()
    const companyId = new mongoose.Types.ObjectId(id)
    const company = await Company.findById(id).lean()
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

    const [{ totalBilled, totalReceived, outstanding }, totalProfit, sellingHistory, paymentHistory] = await Promise.all([
      getOutstanding(companyId),
      getTotalProfit(companyId),
      SellBill.find({ company: companyId }).sort({ billDate: -1, createdAt: -1 }).limit(50).lean().populate('items'),
      PaymentReceipt.find({ company: companyId }).sort({ paymentDate: -1 }).limit(50).lean().populate('bankAccount', 'accountName'),
    ])

    const sellingRows = sellingHistory.map((bill) => {
      const items = (bill as { items?: { totalAmount: number; totalProfit: number; ctnSold?: number; product?: unknown }[] })?.items ?? []
      const totalCtn = items.reduce((s, i) => s + (i.ctnSold ?? 0), 0)
      const billAmount = (bill as { grandTotal?: number }).grandTotal ?? bill.totalAmount
      const profit = items.reduce((s, i) => s + (i.totalProfit ?? 0), 0)
      return {
        _id: bill._id,
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        products: items.length,
        totalCtn,
        totalAmount: billAmount,
        profit,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        company,
        totalBilled,
        totalReceived,
        outstanding,
        totalProfit,
        sellingHistory: sellingRows,
        paymentHistory: paymentHistory.map((p) => ({
          _id: p._id,
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMode: p.paymentMode,
          bankAccount: (p as { bankAccount?: { accountName: string } })?.bankAccount,
          remark: p.remark,
        })),
      },
    })
  } catch (error) {
    console.error('Company get API Error:', error)
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

export async function PUT(
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
        { success: false, error: 'Validation failed', message: 'Invalid company id' },
        { status: 400 }
      )
    }
    const body = await req.json()

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)
    const company = await Company.findById(id)
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

    if (body.companyName != null && typeof body.companyName === 'string' && body.companyName.trim()) {
      company.companyName = body.companyName.trim()
    }
    if (body.ownerName !== undefined)
      company.ownerName =
        body.ownerName == null || body.ownerName === ''
          ? undefined
          : String(body.ownerName).trim()
    if (body.contact1Name !== undefined)
      company.contact1Name =
        body.contact1Name == null || body.contact1Name === ''
          ? undefined
          : String(body.contact1Name).trim()
    if (body.contact1Mobile !== undefined)
      company.contact1Mobile =
        body.contact1Mobile == null || body.contact1Mobile === ''
          ? undefined
          : String(body.contact1Mobile).trim()
    if (body.contact2Name !== undefined)
      company.contact2Name =
        body.contact2Name == null || body.contact2Name === ''
          ? undefined
          : String(body.contact2Name).trim()
    if (body.contact2Mobile !== undefined)
      company.contact2Mobile =
        body.contact2Mobile == null || body.contact2Mobile === ''
          ? undefined
          : String(body.contact2Mobile).trim()
    if (body.gstNumber !== undefined)
      company.gstNumber =
        body.gstNumber == null || body.gstNumber === ''
          ? undefined
          : String(body.gstNumber).trim()
    if (body.address !== undefined)
      company.address =
        body.address == null || body.address === ''
          ? undefined
          : String(body.address).trim()
    if (body.city !== undefined)
      company.city =
        body.city == null || body.city === ''
          ? undefined
          : String(body.city).trim()
    if (body.primaryMobile !== undefined)
      company.primaryMobile =
        body.primaryMobile == null || body.primaryMobile === ''
          ? undefined
          : String(body.primaryMobile).trim()
    company.updatedBy = updatedBy
    await company.save()

    const updated = await Company.findById(id).lean()
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Company update API Error:', error)
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

export async function DELETE(
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
        { success: false, error: 'Validation failed', message: 'Invalid company id' },
        { status: 400 }
      )
    }

    await connectDB()
    const companyId = new mongoose.Types.ObjectId(id)
    const company = await Company.findById(id).lean()
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

    const [sellBillsCount, paymentReceiptsCount] = await Promise.all([
      SellBill.countDocuments({ company: companyId }),
      PaymentReceipt.countDocuments({ company: companyId }),
    ])

    if (sellBillsCount > 0 || paymentReceiptsCount > 0) {
      const parts: string[] = []
      if (sellBillsCount > 0) parts.push(`${sellBillsCount} sale bill(s)`)
      if (paymentReceiptsCount > 0) parts.push(`${paymentReceiptsCount} payment receipt(s)`)
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: `Cannot delete company because it has linked records: ${parts.join(' and ')}. Remove or reassign them first.`,
        },
        { status: 403 }
      )
    }

    await Company.findByIdAndDelete(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Company delete API Error:', error)
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
