import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import * as XLSX from 'xlsx'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { PnlPdfDocument, StockPdfDocument, SellingPdfDocument, BuyingPdfDocument } from '@/lib/report-pdf'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

const REPORT_TYPES = ['pnl', 'stock', 'selling', 'buying'] as const
const FORMATS = ['pdf', 'excel'] as const

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
    const formatType = searchParams.get('format') as (typeof FORMATS)[number] | null
    const reportType = searchParams.get('reportType') as (typeof REPORT_TYPES)[number] | null
    if (!formatType || !FORMATS.includes(formatType) || !reportType || !REPORT_TYPES.includes(reportType)) {
      return NextResponse.json(
        { success: false, error: 'Bad request', message: 'Invalid format or reportType' },
        { status: 400 }
      )
    }
    const period = searchParams.get('period') ?? 'month'
    const startDate = searchParams.get('startDate')?.trim() ?? ''
    const endDate = searchParams.get('endDate')?.trim() ?? ''
    const withExpenses = searchParams.get('withExpenses') === 'true'

    const params = new URLSearchParams()
    params.set('period', period)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (reportType === 'pnl') params.set('withExpenses', String(withExpenses))

    const origin = new URL(req.url).origin
    const auth = req.headers.get('authorization') ?? ''
    const reportUrl = `${origin}/api/reports/${reportType}?${params.toString()}`
    const res = await fetch(reportUrl, { headers: { authorization: auth } })
    const json = await res.json()
    if (!res.ok || !json.success) {
      return NextResponse.json(
        { success: false, error: json.error ?? 'Fetch failed', message: json.message ?? 'Could not load report data' },
        { status: 502 }
      )
    }
    const data = json.data as unknown

    if (formatType === 'pdf') {
      // Basic data presence check so we fail fast with a clear error instead of React's minified #130.
      if (!data) {
        return NextResponse.json(
          {
            success: false,
            error: 'No data',
            message: 'No data returned for report export',
          },
          { status: 400 }
        )
      }

      let doc: React.ReactElement<any> | null = null

      if (reportType === 'pnl') {
        doc = React.createElement(PnlPdfDocument, {
          data: data as Parameters<typeof PnlPdfDocument>[0]['data'],
        })
      } else if (reportType === 'stock') {
        doc = React.createElement(StockPdfDocument, {
          data: data as Parameters<typeof StockPdfDocument>[0]['data'],
        })
      } else if (reportType === 'selling') {
        const d = data as {
          summary: { totalBills: number; totalRevenue: number; totalProfit: number; avgBillValue: number }
          bills: {
            billNumber: number
            billDate: Date | string
            companyName: string
            productCount: number
            amount: number
            profit: number
          }[]
        }
        const bills = d.bills.map((b) => ({
          ...b,
          billDate:
            typeof b.billDate === 'string'
              ? b.billDate
              : format(new Date(b.billDate), 'yyyy-MM-dd'),
        }))
        doc = React.createElement(SellingPdfDocument, { data: { summary: d.summary, bills } })
      } else {
        const d = data as {
          summary: { totalEntries: number; totalAmount: number; totalGiven: number; totalRemaining: number }
          entries: {
            entryDate: Date | string
            productName: string
            totalCtn: number
            totalAmount: number
            givenAmount: number
            remainingAmount: number
            currentStatus: string
          }[]
        }
        const entries = d.entries.map((e) => ({
          ...e,
          entryDate:
            typeof e.entryDate === 'string'
              ? e.entryDate
              : format(new Date(e.entryDate), 'yyyy-MM-dd'),
        }))
        doc = React.createElement(BuyingPdfDocument, { data: { summary: d.summary, entries } })
      }

      // Validate that we actually built a valid React element for @react-pdf/renderer.
      if (!doc || !React.isValidElement(doc)) {
        console.error('PDF export: invalid React element for reportType:', reportType)
        console.error('PDF export data snapshot:', JSON.stringify(data, null, 2))
        return NextResponse.json(
          {
            success: false,
            error: 'PDF generation failed',
            message: 'Internal error while building PDF document',
          },
          { status: 500 }
        )
      }

      try {
        const buffer = await renderToBuffer(doc)
        const filename = `report-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.pdf`
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        })
      } catch (error) {
        console.error('PDF render error for reportType:', reportType, error)
        try {
          // Log a small snapshot of the data that caused the issue.
          const snapshot = JSON.stringify(data, null, 2)
          console.error(
            'PDF render data snapshot (truncated):',
            snapshot.length > 5000 ? snapshot.slice(0, 5000) + '…' : snapshot
          )
        } catch {
          // ignore JSON stringify issues
        }
        return NextResponse.json(
          {
            success: false,
            error: 'PDF generation failed',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown error while rendering PDF',
          },
          { status: 500 }
        )
      }
    }

    // Excel
    const wb = XLSX.utils.book_new()

    if (reportType === 'pnl') {
      const d = data as { summary: { revenue: number; cost: number; grossProfit: number; totalExpenses: number; netProfit: number; marginPct: number }; byProduct: { productName: string; revenue: number; cost: number; profit: number; marginPct: number }[]; byCompany: { companyName: string; revenue: number; profit: number; outstanding: number }[] }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([d.summary]), 'Summary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.byProduct), 'By Product')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.byCompany), 'By Company')
    } else if (reportType === 'stock') {
      const d = data as { summary: Record<string, unknown>; rows: Record<string, unknown>[]; indiaRows?: Record<string, unknown>[] }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([d.summary]), 'Summary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.rows), 'China Stock')
      if (d.indiaRows?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.indiaRows), 'India Stock')
    } else if (reportType === 'selling') {
      const d = data as { summary: Record<string, unknown>; bills: { billNumber: number; billDate: Date | string; companyName: string; productCount: number; amount: number; profit: number }[] }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([d.summary]), 'Summary')
      const bills = d.bills.map((b) => ({ ...b, billDate: typeof b.billDate === 'string' ? b.billDate : format(new Date(b.billDate), 'yyyy-MM-dd') }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bills), 'Bills')
    } else {
      const d = data as { summary: Record<string, unknown>; entries: { entryDate: Date | string; productName: string; totalCtn: number; totalAmount: number; givenAmount: number; remainingAmount: number; currentStatus: string }[] }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([d.summary]), 'Summary')
      const entries = d.entries.map((e) => ({ ...e, entryDate: typeof e.entryDate === 'string' ? e.entryDate : format(new Date(e.entryDate), 'yyyy-MM-dd') }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries), 'Entries')
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `report-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Report export API Error:', error)
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
