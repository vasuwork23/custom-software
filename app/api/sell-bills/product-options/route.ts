import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { getSellableProducts } from '@/lib/product-catalog'

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
    const products = await getSellableProducts(search)

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
