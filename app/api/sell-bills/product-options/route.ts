import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'

export const dynamic = 'force-dynamic'

/**
 * Returns all available products (China + India) for the sell bill product dropdown.
 * Stock totals and qtyPerCtn are computed via aggregation — no per-product N+1 calls.
 * Supports ?search= for server-side filtering.
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

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''

    await connectDB()

    const nameFilter = search ? { productName: new RegExp(search, 'i') } : {}

    const [chinaStock, indiaStock, chinaProducts, indiaProducts] = await Promise.all([
      BuyingEntry.aggregate([
        { $match: { chinaWarehouseReceived: 'yes', availableCtn: { $gt: 0 } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$product',
            availableCtn: { $sum: '$availableCtn' },
            availablePcs: { $sum: { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] } },
            qtyPerCtn: { $first: '$qty' },
          },
        },
      ]),
      IndiaBuyingEntry.aggregate([
        { $match: { availableCtn: { $gt: 0 } } },
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: '$product',
            availableCtn: { $sum: '$availableCtn' },
            availablePcs: { $sum: { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] } },
            qtyPerCtn: { $first: '$qty' },
          },
        },
      ]),
      Product.find(nameFilter).select('productName').sort({ productName: 1 }).lean(),
      IndiaProduct.find(nameFilter).select('productName').sort({ productName: 1 }).lean(),
    ])

    const chinaStockMap = new Map(chinaStock.map((s) => [String(s._id), s]))
    const indiaStockMap = new Map(indiaStock.map((s) => [String(s._id), s]))

    const products: Array<{
      value: string
      label: string
      availableCtn: number
      availablePcs: number
      qtyPerCtn: number
    }> = []

    for (const p of chinaProducts) {
      const stock = chinaStockMap.get(String(p._id))
      if (!stock) continue
      products.push({
        value: `china:${p._id}`,
        label: `${p.productName} 🇨🇳 China`,
        availableCtn: stock.availableCtn,
        availablePcs: stock.availablePcs,
        qtyPerCtn: stock.qtyPerCtn ?? 0,
      })
    }

    for (const p of indiaProducts) {
      const stock = indiaStockMap.get(String(p._id))
      if (!stock) continue
      products.push({
        value: `india:${p._id}`,
        label: `${p.productName} 🇮🇳 India`,
        availableCtn: stock.availableCtn,
        availablePcs: stock.availablePcs,
        qtyPerCtn: stock.qtyPerCtn ?? 0,
      })
    }

    return NextResponse.json({ success: true, data: { products } })
  } catch (error) {
    console.error('Sell bill product options API Error:', error)
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
