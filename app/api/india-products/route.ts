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
      IndiaProduct.find(filter).sort({ productName: 1 }).skip(skip).limit(limit).lean(),
      IndiaProduct.countDocuments(filter),
    ])

    const productIds = products.map((p) => p._id)
    const entryCounts = await IndiaBuyingEntry.aggregate([
      { $match: { product: { $in: productIds } } },
      { $group: { _id: '$product', totalCtn: { $sum: '$totalCtn' }, availableCtn: { $sum: '$availableCtn' }, count: { $sum: 1 } } },
    ])
    const byProduct = Object.fromEntries(entryCounts.map((e) => [String(e._id), e]))

    const list = products.map((p) => {
      const stats = byProduct[String(p._id)] ?? { totalCtn: 0, availableCtn: 0, count: 0 }
      return {
        _id: p._id,
        productName: p.productName,
        productDescription: p.productDescription,
        productImage: p.productImage,
        buyingEntriesCount: stats.count,
        totalCtn: stats.totalCtn,
        availableCtn: stats.availableCtn,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        products: list,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
