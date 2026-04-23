import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaProduct from '@/models/IndiaProduct'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '150', 10)))
    const search = searchParams.get('search')?.trim() ?? ''
    const filterParam = searchParams.get('filter') ?? 'all'

    await connectDB()

    const baseFilter: Record<string, unknown> = {}
    if (search) {
      baseFilter.$or = [
        { productName: new RegExp(search, 'i') },
        { productDescription: new RegExp(search, 'i') },
      ]
    }

    // Fetch all products (for counts) with their entry stats
    const allProducts = await IndiaProduct.find(baseFilter).sort({ productName: 1 }).lean()
    const allProductIds = allProducts.map((p) => p._id)

    const [entryCounts, allEntries] = await Promise.all([
      IndiaBuyingEntry.aggregate([
        { $match: { product: { $in: allProductIds } } },
        {
          $group: {
            _id: '$product',
            totalCtn: { $sum: '$totalCtn' },
            availableCtn: { $sum: '$availableCtn' },
            count: { $sum: 1 },
            hasUnpaid: {
              $sum: {
                $cond: [{ $in: ['$currentStatus', ['unpaid', 'partiallypaid']] }, 1, 0],
              },
            },
          },
        },
      ]),
      IndiaBuyingEntry.find({ product: { $in: allProductIds } }).lean(),
    ])

    const entriesByProd = allEntries.reduce((acc, e) => {
      const pid = String(e.product)
      if (!acc[pid]) acc[pid] = []
      acc[pid].push(e)
      return acc
    }, {} as Record<string, any[]>)

    const byProduct = Object.fromEntries(entryCounts.map((e) => [String(e._id), e]))

    const allMapped = allProducts.map((p) => {
      const stats = byProduct[String(p._id)] ?? { totalCtn: 0, availableCtn: 0, count: 0, hasUnpaid: 0 }
      const pEntries = entriesByProd[String(p._id)] ?? []

      // Calculate available value using the same logic as the stock report
      // to avoid rounding discrepancies (pcs = round(avail * qty), then val = sum(pcs * rate))
      let productAvailableValue = 0
      let productAvailablePcs = 0
      for (const e of pEntries) {
        const pcs = Math.round((e.availableCtn || 0) * (e.qty || 0))
        productAvailablePcs += pcs
        const cost = e.finalCost ?? e.rate ?? 0
        if (cost > 0) {
          productAvailableValue += pcs * cost
        }
      }

      return {
        _id: p._id,
        productName: p.productName,
        productDescription: p.productDescription,
        productImage: p.productImage,
        buyingEntriesCount: stats.count as number,
        totalCtn: stats.totalCtn as number,
        availableCtn: stats.availableCtn as number,
        availablePcs: productAvailablePcs,
        availableValue: Number(productAvailableValue.toFixed(2)),
        hasUnpaidEntries: (stats.hasUnpaid as number) > 0,
      }
    })

    // Compute counts per filter
    const counts = {
      all: allMapped.length,
      available: allMapped.filter((p) => p.availableCtn > 0).length,
      fullySold: allMapped.filter((p) => p.totalCtn > 0 && p.availableCtn === 0).length,
      unpaid: allMapped.filter((p) => p.hasUnpaidEntries).length,
      noStock: allMapped.filter((p) => p.totalCtn === 0).length,
    }

    // Apply quick filter
    let filtered = allMapped
    if (filterParam === 'available') filtered = allMapped.filter((p) => p.availableCtn > 0)
    else if (filterParam === 'fullySold') filtered = allMapped.filter((p) => p.totalCtn > 0 && p.availableCtn === 0)
    else if (filterParam === 'unpaid') filtered = allMapped.filter((p) => p.hasUnpaidEntries)
    else if (filterParam === 'noStock') filtered = allMapped.filter((p) => p.totalCtn === 0)

    // Totals across FILTERED products (reflects current tab)
    const totals = {
      totalCtn: filtered.reduce((s, p) => s + (p.totalCtn || 0), 0),
      availableCtn: filtered.reduce((s, p) => s + (p.availableCtn || 0), 0),
      availableValue: Number(filtered.reduce((s, p) => s + (p.availableValue || 0), 0).toFixed(2)),
    }

    // Paginate filtered results
    const total = filtered.length
    const skip = (page - 1) * limit
    const list = filtered.slice(skip, skip + limit)

    return NextResponse.json({
      success: true,
      data: {
        products: list,
        counts,
        totals,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      },
    })
  } catch (error) {
    console.error('India products list API Error:', error)
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

const createSchema = {
  productName: (v: unknown) => typeof v === 'string' && v.trim().length > 0,
  productDescription: (v: unknown) => v == null || typeof v === 'string',
  productImage: (v: unknown) => v == null || typeof v === 'string',
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const body = await req.json()
    if (!createSchema.productName(body.productName)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Product name is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const product = await IndiaProduct.create({
      productName: body.productName.trim(),
      productDescription: body.productDescription?.trim() || undefined,
      productImage: body.productImage || undefined,
      createdBy,
      updatedBy: createdBy,
    })

    return NextResponse.json({
      success: true,
      data: {
        _id: product._id,
        productName: product.productName,
        productDescription: product.productDescription,
        productImage: product.productImage,
        createdAt: product.createdAt,
      },
    })
  } catch (error) {
    console.error('India product create API Error:', error)
    if (error instanceof Error && error.message?.includes('E11000')) {
      return NextResponse.json(
        { success: false, error: 'Duplicate', message: 'An India product with this name already exists' },
        { status: 400 }
      )
    }
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
