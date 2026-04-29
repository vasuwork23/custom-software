import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    await connectDB()

    const companies = await Company.find({})
      .select('companyName ownerName city primaryMobile contact1Mobile outstandingBalance totalProfit')
      .sort({ companyName: 1 })
      .lean()

    const rows = companies.map((c) => ({
      'Company Name': c.companyName,
      'Owner': c.ownerName ?? '',
      'City': (c as Record<string, unknown>).city ?? '',
      'Mobile': (c as Record<string, unknown>).primaryMobile ?? (c as Record<string, unknown>).contact1Mobile ?? '',
      'Outstanding (₹)': Number((c as Record<string, unknown>).outstandingBalance ?? 0),
      'Status':
        Number((c as Record<string, unknown>).outstandingBalance ?? 0) > 0
          ? 'To Receive'
          : Number((c as Record<string, unknown>).outstandingBalance ?? 0) < 0
          ? 'Credit'
          : 'Clear',
      'Total Profit (₹)': Number((c as Record<string, unknown>).totalProfit ?? 0),
    }))

    const totalPositive = rows
      .filter((r) => r['Outstanding (₹)'] > 0)
      .reduce((s, r) => s + r['Outstanding (₹)'], 0)
    const totalNegative = rows
      .filter((r) => r['Outstanding (₹)'] < 0)
      .reduce((s, r) => s + Math.abs(r['Outstanding (₹)']), 0)

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    // Column widths
    ws['!cols'] = [
      { wch: 30 },
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 12 },
      { wch: 18 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Outstanding')

    // Summary sheet
    const summaryData = [
      { Label: 'Total To Receive (₹)', Value: totalPositive },
      { Label: 'Total Credit (₹)', Value: totalNegative },
      { Label: 'Net Outstanding (₹)', Value: totalPositive - totalNegative },
    ]
    const wsSummary = XLSX.utils.json_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="outstanding-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('[companies/export]', err)
    return NextResponse.json({ success: false, message: 'Export failed' }, { status: 500 })
  }
}
