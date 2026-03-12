import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Product from '@/models/Product'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/**
 * GET /api/products/china-with-pending-entries
 * Returns China (master) products that have at least one buying entry
 * with currentStatus = 'unpaid' or 'partiallypaid'.
 * Used to populate Sophia Pay Out dialog dropdowns.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    await connectDB()

    const pendingEntries = await BuyingEntry.find({
      currentStatus: { $in: ['unpaid', 'partiallypaid'] },
    })
      .sort({ entryDate: 1, createdAt: 1 })
      .lean()

    const productIds = [...new Set(pendingEntries.map((e) => String(e.product)))]
    if (productIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { products: [] },
      })
    }

    const products = await Product.find({
      _id: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .sort({ productName: 1 })
      .lean()

    const entriesByProduct = new Map<string, typeof pendingEntries>()
    for (const e of pendingEntries) {
      const pid = String(e.product)
      if (!entriesByProduct.has(pid)) entriesByProduct.set(pid, [])
      entriesByProduct.get(pid)!.push(e)
    }

    const list = products.map((p) => {
      const pid = String(p._id)
      const entries = entriesByProduct.get(pid) ?? []
      return {
        _id: p._id,
        productName: (p as { productName?: string }).productName,
        pendingEntries: entries.map((e) => ({
          _id: e._id,
          entryDate: e.entryDate,
          totalCtn: e.totalCtn,
          totalAmount: e.totalAmount,
          givenAmount: e.givenAmount,
          remainingAmount: e.remainingAmount,
          currentStatus: e.currentStatus,
        })),
      }
    })

    return NextResponse.json({ success: true, data: { products: list } })
  } catch (error) {
    console.error('China products with pending entries API Error:', error)
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
