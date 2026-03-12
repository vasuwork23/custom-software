import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import { OutstandingTemplate } from '@/components/pdf/OutstandingTemplate'
import { generateOutstandingFileName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Invalid company id',
        },
        { status: 400 }
      )
    }

    await connectDB()
    void Company

    const company = await Company.findById(id)
      .select('companyName ownerName contact1Mobile contact1Name address')
      .lean()
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Company not found' },
        { status: 404 }
      )
    }

    const companyId = new mongoose.Types.ObjectId(id)

    // Build full statement: bills (debit) + payments (credit), with running balance.
    const [bills, payments] = await Promise.all([
      SellBill.find({ company: companyId })
        .sort({ billDate: 1, createdAt: 1 })
        .lean(),
      PaymentReceipt.find({ company: companyId })
        .sort({ date: 1, createdAt: 1 })
        .lean(),
    ])

    const allTx = [
      ...bills.map((b) => ({
        date: b.billDate,
        createdAt: b.createdAt,
        description: `Invoice ${b.billNumber}${
          (b as { notes?: string }).notes
            ? ` — ${(b as { notes?: string }).notes}`
            : ''
        }`,
        debit: (b as { grandTotal?: number }).grandTotal ?? b.totalAmount,
        credit: null as number | null,
      })),
      ...payments.map((p) => ({
        date: p.date,
        createdAt: p.createdAt,
        description: `Payment received${
          (p as { notes?: string }).notes
            ? ` — ${(p as { notes?: string }).notes}`
            : ''
        }`,
        debit: null as number | null,
        credit: p.amount,
      })),
    ].sort((a, b) => {
      const ad = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
      const bd = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
      return ad - bd
    })

    let balance = 0
    const transactions = allTx.map((tx) => {
      if (tx.debit) balance += tx.debit
      if (tx.credit) balance -= tx.credit
      return {
        date: tx.date,
        description: tx.description,
        debit: tx.debit,
        credit: tx.credit,
        balance,
      }
    })

    const generatedDate = new Date()

    const doc = React.createElement(OutstandingTemplate, {
      company: {
        companyName: company.companyName,
        address: (company as { address?: string }).address,
        mobile: company.contact1Mobile,
        ownerName: company.ownerName,
        contact1Mobile: company.contact1Mobile,
        contact1Name: company.contact1Name,
      },
      transactions,
      generatedDate,
      yourCompanyName: process.env.COMPANY_NAME ?? '',
      yourAddress: process.env.COMPANY_ADDRESS ?? '',
      yourPhone: process.env.COMPANY_PHONE ?? '',
    })

    const pdfBuffer = await renderToBuffer(doc)

    const filename = generateOutstandingFileName(company.companyName)

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Company outstanding PDF API Error:', error)
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

