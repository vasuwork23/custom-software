import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'

export const dynamic = 'force-dynamic'

/**
 * POST /api/fix/restore-sell-bill-amounts
 * Restore totalAmount on SellBills that are 0 (or missing) by recalculating from their items.
 * Uses item.totalAmount when present, else ratePerPcs * pcsSold (with field name fallbacks).
 * Owner-only.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can run restore sell bill amounts' },
        { status: 403 }
      )
    }

    await connectDB()

    const bills = await SellBill.find({ $or: [{ totalAmount: 0 }, { totalAmount: { $exists: false } }] }).lean()
    let restored = 0

    for (const bill of bills) {
      const items = await SellBillItem.find({ sellBill: bill._id }).lean()
      let totalAmount = 0
      for (const item of items) {
        const amount = Number(item.totalAmount ?? 0)
        if (amount > 0) {
          totalAmount += amount
        } else {
          const price = Number(
            item.ratePerPcs ??
            (item as Record<string, unknown>).sellingPrice ??
            (item as Record<string, unknown>).salePrice ??
            (item as Record<string, unknown>).price ??
            0
          )
          const qty = Number(
            item.pcsSold ??
            (item as Record<string, unknown>).quantity ??
            (item as Record<string, unknown>).qty ??
            (item as Record<string, unknown>).pieces ??
            0
          )
          totalAmount += price * qty
        }
      }

      console.log(`[restore-sell-bill-amounts] Bill ${bill.billNumber}: restoring totalAmount to ${totalAmount}`)
      await SellBill.findByIdAndUpdate(bill._id, { totalAmount })
      restored += 1
    }

    return NextResponse.json({
      success: true,
      data: { restored, totalChecked: bills.length },
      message: `Restored totalAmount for ${restored} sell bill(s).`,
    })
  } catch (error) {
    console.error('Restore sell bill amounts API Error:', error)
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
