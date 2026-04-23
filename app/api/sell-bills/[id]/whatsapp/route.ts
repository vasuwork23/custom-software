import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import { sendBillOnWhatsApp } from '@/lib/whatsapp'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function POST(
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
        { success: false, error: 'Validation failed', message: 'Invalid bill id' },
        { status: 400 }
      )
    }

    await connectDB()

    const bill = await SellBill.findById(id)
      .lean()
      .populate('company', 'companyName ownerName contact1Mobile contact2Mobile address city')
      .populate({ path: 'items', populate: [{ path: 'product', select: 'productName' }, { path: 'indiaProduct', select: 'productName' }] })

    if (!bill) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Sell bill not found' },
        { status: 404 }
      )
    }

    const billData = bill as { totalAmount: number; grandTotal?: number }
    const result = await sendBillOnWhatsApp({
      _id: String(bill._id),
      billNumber: bill.billNumber,
      billDate: String(bill.billDate),
      totalAmount: billData.grandTotal ?? billData.totalAmount,
      company: bill.company as {
        companyName?: string
        ownerName?: string
        contact1Mobile?: string
        contact2Mobile?: string
        address?: string
        city?: string
      },
      items: (bill.items as { product?: { productName?: string }; indiaProduct?: { productName?: string }; ctnSold: number; pcsSold: number; ratePerPcs: number; totalAmount: number }[]) ?? [],
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp send failed', message: result.message },
        { status: 400 }
      )
    }

    const updatedBy = await resolveCreatedBy(user.id)
    await SellBill.findByIdAndUpdate(id, {
      whatsappSent: true,
      whatsappSentAt: new Date(),
      updatedBy,
    })

    return NextResponse.json({
      success: true,
      data: { sent: true, message: 'Bill sent on WhatsApp.' },
    })
  } catch (error) {
    console.error('Sell bill WhatsApp API Error:', error)
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
