import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Product from '@/models/Product'
import BuyingEntry from '@/models/BuyingEntry'

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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)))
    const search = searchParams.get('search')?.trim() ?? ''
    type ChinaFilter =
      | 'all'
      | 'chinaFactory'
      | 'chinaWh'
      | 'inTransit'
      | 'inIndia'
      | 'fullySold'
      | 'unpaid'
    const rawFilter = searchParams.get('filter') ?? 'all'
    const allowedFilters: ChinaFilter[] = [
      'all',
      'chinaFactory',
      'chinaWh',
      'inTransit',
      'inIndia',
      'fullySold',
      'unpaid',
    ]
    const chinaFilter: ChinaFilter = allowedFilters.includes(rawFilter as ChinaFilter)
      ? (rawFilter as ChinaFilter)
      : 'all'

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (search) {
      filter.$or = [
        { productName: new RegExp(search, 'i') },
        { productDescription: new RegExp(search, 'i') },
      ]
    }

    const [products, total] = await Promise.all([
      // Fetch all products matching search; filtering + pagination handled after enrichment
      Product.find(filter).sort({ productName: 1 }).lean(),
      Product.countDocuments(filter),
    ])

    const productIds = products.map((p) => p._id)

    const [entryStats, availablePcsStats] = await Promise.all([
    BuyingEntry.aggregate([
      { $match: { product: { $in: productIds } } },
      {
        $group: {
          _id: '$product',
          totalCtn: { $sum: '$totalCtn' },
          // Only count CTN in China warehouse when entry is actually received there
          chinaWarehouseCtn: {
            $sum: {
              $cond: [
                { $eq: ['$chinaWarehouseReceived', 'yes'] },
                { $ifNull: ['$chinaWarehouseCtn', 0] },
                0,
              ],
            },
          },
          inTransitCtn: { $sum: { $ifNull: ['$inTransitCtn', 0] } },
          availableCtn: { $sum: '$availableCtn' },
          soldCtn: { $sum: { $ifNull: ['$soldCtn', 0] } },
          // CTN still at factory (warehouse not yet received)
          chinaFactoryCtn: {
            $sum: {
              $cond: [
                { $eq: ['$chinaWarehouseReceived', 'no'] },
                '$totalCtn',
                0,
              ],
            },
          },
          totalCbm: { $sum: { $ifNull: ['$totalCbm', 0] } },
          totalWeight: { $sum: { $ifNull: ['$totalWeight', 0] } },
          remainingAmount: { $sum: { $ifNull: ['$remainingAmount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    BuyingEntry.aggregate([
      { $match: { product: { $in: productIds }, chinaWarehouseReceived: 'yes' } },
      {
        $group: {
          _id: '$product',
          availablePcs: {
            $sum: { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] },
          },
        },
      },
    ]),
  ])

    const statusStats = await BuyingEntry.aggregate([
      { $match: { product: { $in: productIds } } },
      {
        $group: {
          _id: '$product',
          hasUnpaidEntries: {
            $max: {
              $cond: [{ $ne: ['$currentStatus', 'paid'] }, true, false],
            },
          },
          hasWhReceived: {
            $max: {
              $cond: [{ $eq: ['$chinaWarehouseReceived', 'yes'] }, true, false],
            },
          },
          hasNotReceived: {
            $max: {
              $cond: [{ $eq: ['$chinaWarehouseReceived', 'no'] }, true, false],
            },
          },
        },
      },
    ])

    const statsByProduct = Object.fromEntries(entryStats.map((e) => [String(e._id), e]))
    const statusByProduct = Object.fromEntries(statusStats.map((e) => [String(e._id), e]))
    const availablePcsByProduct = Object.fromEntries(availablePcsStats.map((e) => [String(e._id), e.availablePcs as number]))

    const enrichedProducts = products.map((p) => {
      const stats = statsByProduct[String(p._id)] ?? {
        totalCtn: 0,
        chinaWarehouseCtn: 0,
        inTransitCtn: 0,
        availableCtn: 0,
        soldCtn: 0,
        chinaFactoryCtn: 0,
        totalCbm: 0,
        totalWeight: 0,
        remainingAmount: 0,
        count: 0,
      }
      const status = statusByProduct[String(p._id)] ?? {
        hasUnpaidEntries: false,
        hasWhReceived: false,
        hasNotReceived: false,
      }

      const totalCtn = stats.totalCtn ?? 0
      const chinaWarehouseCtn = stats.chinaWarehouseCtn ?? 0
      const inTransitCtn = stats.inTransitCtn ?? 0
      const availableCtn = stats.availableCtn ?? 0
      const soldCtn = stats.soldCtn ?? 0
      const chinaFactoryCtn = stats.chinaFactoryCtn ?? 0
      const totalCbm = stats.totalCbm ?? 0
      const totalWeight = stats.totalWeight ?? 0
      const remainingAmount = stats.remainingAmount ?? 0
      const buyingEntries = stats.count ?? 0

      const chinaWarehouseReceived: 'yes' | 'no' =
        status.hasWhReceived && !status.hasNotReceived
          ? 'yes'
          : status.hasNotReceived && !status.hasWhReceived
          ? 'no'
          : status.hasWhReceived
          ? 'yes'
          : 'no'

      const hasUnpaidEntries = Boolean(status.hasUnpaidEntries)
      const hasWhReceived = Boolean(status.hasWhReceived)
      const hasNotReceived = Boolean(status.hasNotReceived)

      return {
        _id: p._id,
        productName: p.productName,
        productDescription: p.productDescription,
        productImage: p.productImage,
        buyingEntriesCount: buyingEntries,
        totalCtn,
        chinaWarehouseCtn,
        inTransitCtn,
        availableCtn,
        availablePcs: availablePcsByProduct[String(p._id)] ?? 0,
        soldCtn,
        chinaFactoryCtn,
        totalCbm,
        totalWeight,
        remainingAmount,
        hasUnpaidEntries,
        chinaWarehouseReceived,
        hasWhReceived,
        hasNotReceived,
      }
    })

    // Global counts for filter chips (affected by search, but not by active filter)
    const counts = {
      all: enrichedProducts.length,
      // Count products that still have any entries at factory
      chinaFactory: enrichedProducts.filter((p) => p.hasNotReceived).length,
      // Count products that have any entries received into China warehouse
      chinaWh: enrichedProducts.filter((p) => p.hasWhReceived && p.chinaWarehouseCtn > 0).length,
      inTransit: enrichedProducts.filter((p) => p.inTransitCtn > 0).length,
      inIndia: enrichedProducts.filter((p) => p.availableCtn > 0).length,
      fullySold: enrichedProducts.filter((p) => p.soldCtn > 0 && p.availableCtn === 0).length,
      unpaid: enrichedProducts.filter((p) => p.hasUnpaidEntries).length,
    }

    // Apply active filter server-side
    const filteredProducts = enrichedProducts.filter((p) => {
      switch (chinaFilter) {
        case 'chinaFactory':
          return p.hasNotReceived
        case 'chinaWh':
          return p.hasWhReceived && p.chinaWarehouseCtn > 0
        case 'inTransit':
          return p.inTransitCtn > 0
        case 'inIndia':
          return p.availableCtn > 0
        case 'fullySold':
          return p.soldCtn > 0 && p.availableCtn === 0
        case 'unpaid':
          return p.hasUnpaidEntries
        case 'all':
        default:
          return true
      }
    })

    const totalFiltered = filteredProducts.length
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit))
    const start = (page - 1) * limit
    const paginatedProducts = filteredProducts.slice(start, start + limit)

    // Totals across all filtered products (not just current page)
    const { totalCbm: sumCbm, totalWeight: sumWeight, remainingAmount: sumRemaining } = filteredProducts.reduce(
      (acc, p) => {
        acc.totalCbm += p.totalCbm ?? 0
        acc.totalWeight += p.totalWeight ?? 0
        acc.remainingAmount += p.remainingAmount ?? 0
        return acc
      },
      { totalCbm: 0, totalWeight: 0, remainingAmount: 0 }
    )

    return NextResponse.json({
      success: true,
      data: {
        products: paginatedProducts,
        counts,
        totals: {
          cbm: sumCbm,
          weight: sumWeight,
          remainingToPay: sumRemaining,
        },
        pagination: { page, limit, total: totalFiltered, pages: totalPages },
      },
    })
  } catch (error) {
    console.error('Products list API Error:', error)
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

    const product = await Product.create({
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
    console.error('Product create API Error:', error)
    if (error instanceof Error && error.message?.includes('E11000')) {
      return NextResponse.json(
        { success: false, error: 'Duplicate', message: 'A product with this name already exists' },
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
