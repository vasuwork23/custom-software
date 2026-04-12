import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import PaymentReceipt from '@/models/PaymentReceipt'
import { OutstandingTemplate, type OutstandingTemplateProps } from '@/components/pdf/OutstandingTemplate'
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
    void SellBillItem
    void Product
    void IndiaProduct

    const company = await Company.findById(id)
      .select('companyName ownerName contact1Mobile contact1Name address openingBalance openingBalanceNotes')
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
        .populate({
          path: 'items',
          model: 'SellBillItem',
          populate: [
            { path: 'product', model: 'Product', select: 'productName' },
            { path: 'indiaProduct', model: 'IndiaProduct', select: 'productName' },
          ],
        })
        .lean(),
      PaymentReceipt.find({ company: companyId })
        .sort({ paymentDate: 1, createdAt: 1 })
        .lean(),
    ])

    const allTx = [
      ...bills.map((b) => {
        const bAny = b as any
        const items: { productName: string; ctnSold: number; pcsSold: number; ratePerPcs: number }[] =
          (bAny.items || []).map((item: any) => ({
            productName:
              item.product?.productName ||
              item.indiaProduct?.productName ||
              'Product',
            ctnSold: item.ctnSold ?? 0,
            pcsSold: item.pcsSold ?? 0,
            ratePerPcs: item.ratePerPcs ?? 0,
          }))
        return {
          date: b.billDate,
          createdAt: b.createdAt,
          description: `INV-${b.billNumber}${
            (b as { notes?: string }).notes
              ? ` — ${(b as { notes?: string }).notes}`
              : ''
          }`,
          debit: bAny.grandTotal ?? b.totalAmount,
          credit: null as number | null,
          items,
        }
      }),
      ...payments.map((p) => {
        const pAny = p as { paymentDate?: Date; date?: Date; companyNote?: string; remark?: string; paymentMode?: string }
        const isSetOff = pAny.paymentMode === 'set_off'
        let description: string
        if (isSetOff) {
          const cleanRemark = pAny.remark
            ? pAny.remark
                .replace(/^Payment for India Product:\s*/i, '')
                .replace(/\s*-\s*\d{2}\s+\w+\s+\d{4}$/, '')
                .replace(/₹/g, '')
            : ''
          description = `Payment received for purchase${cleanRemark ? ` ${cleanRemark}` : ''}`
          if (pAny.companyNote) description += ` (${pAny.companyNote})`
        } else {
          description = `Payment received${pAny.companyNote ? ` — ${pAny.companyNote}` : ''}`
        }
        return {
          items: [] as { productName: string; ctnSold: number; pcsSold: number; ratePerPcs: number }[],
          date: (pAny.paymentDate || pAny.date || new Date()) as Date,
          createdAt: p.createdAt,
          description,
          debit: null as number | null,
          credit: p.amount,
        }
      }),
    ].sort((a, b) => {
      const aDate = a.date instanceof Date ? a.date.getTime() : new Date(a.date as string).getTime()
      const bDate = b.date instanceof Date ? b.date.getTime() : new Date(b.date as string).getTime()
      if (aDate !== bDate) return aDate - bDate
      
      const ad = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
      const bd = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
      return ad - bd
    })

    let balance = company.openingBalance || 0
    let lastZeroBalanceIndex = -1

    const computedTransactions = allTx.map((tx, index) => {
      if (tx.debit) balance += tx.debit
      if (tx.credit) balance -= tx.credit
      
      // If balance hits zero (safely comparing floating point), we keep track of this index.
      if (Math.abs(balance) < 0.001) {
        lastZeroBalanceIndex = index
      }

      return {
        date: tx.date,
        description: tx.description,
        debit: tx.debit,
        credit: tx.credit,
        balance,
        items: tx.items,
      }
    })

    let transactions = computedTransactions
    let modifiedOpeningBalance = company.openingBalance || 0
    let modifiedOpeningBalanceNotes = company.openingBalanceNotes

    if (lastZeroBalanceIndex !== -1) {
      transactions = computedTransactions.slice(lastZeroBalanceIndex + 1)
      modifiedOpeningBalance = 0
      modifiedOpeningBalanceNotes = 'Balance Brought Forward (Cleared)'
    }

    const generatedDate = new Date()

    const doc = React.createElement(OutstandingTemplate, {
      company: {
        companyName: company.companyName,
        address: (company as { address?: string }).address,
        mobile: company.contact1Mobile,
        ownerName: company.ownerName,
        contact1Mobile: company.contact1Mobile,
        contact1Name: company.contact1Name,
        openingBalance: modifiedOpeningBalance,
        openingBalanceNotes: modifiedOpeningBalanceNotes,
      },
      transactions: transactions as OutstandingTemplateProps['transactions'],
      generatedDate,
      yourCompanyName: process.env.COMPANY_NAME ?? '',
      yourAddress: process.env.COMPANY_ADDRESS ?? '',
      yourPhone: process.env.COMPANY_PHONE ?? '',
    })

    const pdfBuffer = await renderToBuffer(doc as any)

    const filename = generateOutstandingFileName(company.companyName)

    return new NextResponse(pdfBuffer as any, {
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

