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
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)))
    const search = searchParams.get('search')?.trim() ?? ''

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (search) {
      filter.$or = [
        { productName: new RegExp(search, 'i') },
        { productDescription: new RegExp(search, 'i') },
      ]
    }

    const skip = (page - 1) * limit
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ productName: 1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ])

    const productIds = products.map((p) => p._id)

    const entryStats = await BuyingEntry.aggregate([
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
          count: { $sum: 1 },
        },
      },
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

    const enrichedProducts = products.map((p) => {
      const stats = statsByProduct[String(p._id)] ?? {
        totalCtn: 0,
        chinaWarehouseCtn: 0,
        inTransitCtn: 0,
        availableCtn: 0,
        soldCtn: 0,
        chinaFactoryCtn: 0,
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
        soldCtn,
        chinaFactoryCtn,
        hasUnpaidEntries,
        chinaWarehouseReceived,
        hasWhReceived,
        hasNotReceived,
      }
    })

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

    return NextResponse.json({
      success: true,
      data: {
        products: enrichedProducts,
        counts,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
