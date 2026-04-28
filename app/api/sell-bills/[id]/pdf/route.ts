import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import { renderToBuffer, DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { BillTemplate } from '@/components/pdf/BillTemplate'
import mongoose from 'mongoose'
import { generateBillFileName } from '@/lib/utils'

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
        { success: false, error: 'Validation failed', message: 'Invalid bill id' },
        { status: 400 }
      )
    }

    await connectDB()

    const bill = await SellBill.findById(id)
      .lean()
      .populate('company', 'companyName ownerName contact1Mobile contact2Mobile address city openingBalance')
      .populate({ path: 'items', populate: [{ path: 'product', select: 'productName' }, { path: 'indiaProduct', select: 'productName' }] })

    if (!bill) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Sell bill not found' },
        { status: 404 }
      )
    }

    const billData = bill as {
      totalAmount: number
      grandTotal?: number
      extraCharges?: number
      extraChargesNote?: string
      discount?: number
      discountNote?: string
      isCashbook?: boolean
    }

    // Compute current outstanding for this company (if any) — used in PDF outstanding box.
    let companyOutstanding: number | undefined
    if (bill.company && !(billData.isCashbook === true)) {
      const companyId = (bill.company as { _id?: mongoose.Types.ObjectId })._id
      if (companyId) {
        const [billedRes, receivedRes] = await Promise.all([
          SellBill.aggregate([
            { $match: { company: companyId } },
            {
              $group: {
                _id: null,
                total: {
                  $sum: { $ifNull: ['$grandTotal', '$totalAmount'] },
                },
              },
            },
          ]),
          PaymentReceipt.aggregate([
            { $match: { company: companyId } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ])
        const totalBilled = billedRes[0]?.total ?? 0
        const totalReceived = receivedRes[0]?.total ?? 0
        const openingBalance = (bill.company as { openingBalance?: number }).openingBalance || 0
        companyOutstanding = totalBilled - totalReceived + openingBalance
      }
    }
    const doc = React.createElement(BillTemplate, {
      bill: {
        billNumber: bill.billNumber,
        billDate: String(bill.billDate),
        totalAmount: bill.totalAmount,
        extraCharges: billData.extraCharges,
        extraChargesNote: billData.extraChargesNote,
        discount: billData.discount,
        discountNote: billData.discountNote,
        grandTotal: billData.grandTotal ?? billData.totalAmount,
        isCashbook: billData.isCashbook === true,
        company: bill.company as {
          companyName?: string
          ownerName?: string
          contact1Mobile?: string
          contact2Mobile?: string
          address?: string
          city?: string
        },
        items: (bill.items as unknown as { product?: { productName?: string }; indiaProduct?: { productName?: string }; ctnSold: number; pcsSold: number; ratePerPcs: number; totalAmount: number }[]) ?? [],
      },
      yourCompanyName: process.env.COMPANY_NAME ?? '',
      yourAddress: process.env.COMPANY_ADDRESS ?? '',
      yourPhone: process.env.COMPANY_PHONE ?? '',
      companyOutstanding,
    })
    const rawBuffer = await renderToBuffer(doc as React.ReactElement<DocumentProps>)
    const pdfBuffer = new Uint8Array(rawBuffer)

    const filename = generateBillFileName({
      companyName: (bill.company as { companyName?: string })?.companyName,
      billNumber: bill.billNumber,
      billDate: bill.billDate,
    })

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Sell bill PDF API Error:', error)
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
