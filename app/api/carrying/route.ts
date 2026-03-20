import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import CarryingBill from '@/models/CarryingBill'

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
    const search = searchParams.get('search')?.trim() ?? ''
    const from = searchParams.get('from')?.trim()
    const to = searchParams.get('to')?.trim()

    await connectDB()

    const filter: Record<string, unknown> = {}
    if (search) {
      const regex = new RegExp(search, 'i')
      filter.$or = [{ containerName: regex }, { companyName: regex }]
    }
    if (from || to) {
      filter.createdAt = {}
      if (from) (filter.createdAt as Record<string, Date>).$gte = new Date(from)
      if (to) (filter.createdAt as Record<string, Date>).$lte = new Date(to)
    }

    const bills = await CarryingBill.find(filter).sort({ createdAt: -1 }).lean()

    const mapped = bills.map((b) => {
      const products = (b.products ?? []).map((p) => {
        const totalAmount = (p.totalCBM ?? 0) * (p.priceSellCBM ?? 0)
        const totalProfit = totalAmount - (p.totalCBM ?? 0) * (p.priceBuyCBM ?? 0)
        return {
          id: String(p._id),
          productName: p.productName ?? '',
          totalCBM: p.totalCBM ?? 0,
          priceBuyCBM: p.priceBuyCBM ?? 0,
          priceSellCBM: p.priceSellCBM ?? 0,
          totalAmount,
          totalProfit,
        }
      })

      const totalCBM = products.reduce((s, p) => s + p.totalCBM, 0)
      const totalAmount = products.reduce((s, p) => s + p.totalAmount, 0)
      const totalProfit = products.reduce((s, p) => s + p.totalProfit, 0)

      return {
        id: String(b._id),
        containerName: b.containerName,
        companyName: b.companyName,
        products,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        totalCBM,
        totalAmount,
        totalProfit,
      }
    })

    const overall = mapped.reduce(
      (acc, b) => {
        acc.totalCBM += b.totalCBM
        acc.totalAmount += b.totalAmount
        acc.totalProfit += b.totalProfit
        return acc
      },
      { totalCBM: 0, totalAmount: 0, totalProfit: 0 }
    )

    return NextResponse.json({
      success: true,
      data: {
        bills: mapped,
        totals: overall,
      },
    })
  } catch (error) {
    console.error('Carrying list API Error:', error)
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

interface IncomingProduct {
  id?: string
  productName: string
  totalCBM: number
  priceBuyCBM: number
  priceSellCBM: number
}

interface IncomingBillBody {
  id?: string
  containerName: string
  companyName: string
  products: IncomingProduct[]
}

function normalizeBillBody(body: unknown): IncomingBillBody {
  const raw = body as Partial<IncomingBillBody>
  const containerName = String(raw.containerName ?? '').trim()
  const companyName = String(raw.companyName ?? '').trim()
  const productsRaw = Array.isArray(raw.products) ? raw.products : []

  const products: IncomingProduct[] = productsRaw.map((p) => ({
    id: typeof p.id === 'string' ? p.id : undefined,
    productName: String(p.productName ?? '').trim(),
    totalCBM: Number(p.totalCBM ?? 0) || 0,
    priceBuyCBM: Number(p.priceBuyCBM ?? 0) || 0,
    priceSellCBM: Number(p.priceSellCBM ?? 0) || 0,
  }))

  return { id: raw.id, containerName, companyName, products }
}

function validateBill(body: IncomingBillBody): string | null {
  if (!body.containerName) return 'Container name is required'
  if (!body.companyName) return 'Company name is required'
  if (!body.products.length) return 'At least one product is required'
  if (body.products.some((p) => !p.productName)) return 'Every product must have a name'
  return null
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

    await connectDB()
    const body = normalizeBillBody(await req.json())
    const error = validateBill(body)
    if (error) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: error },
        { status: 400 }
      )
    }

    const userId = await resolveCreatedBy(user.id)

    const products = body.products.map((p) => {
      const totalAmount = p.totalCBM * p.priceSellCBM
      const totalProfit = totalAmount - p.totalCBM * p.priceBuyCBM
      return {
        productName: p.productName,
        totalCBM: p.totalCBM,
        priceBuyCBM: p.priceBuyCBM,
        priceSellCBM: p.priceSellCBM,
        totalAmount,
        totalProfit,
      }
    })

    let billDoc
    if (body.id && mongoose.Types.ObjectId.isValid(body.id)) {
      billDoc = await CarryingBill.findByIdAndUpdate(
        body.id,
        {
          containerName: body.containerName,
          companyName: body.companyName,
          products,
          updatedBy: userId,
        },
        { new: true, runValidators: true }
      )
    } else {
      billDoc = await CarryingBill.create({
        containerName: body.containerName,
        companyName: body.companyName,
        products,
        createdBy: userId,
        updatedBy: userId,
      })
    }

    const bill = billDoc.toObject()
    const mapped = {
      id: String(bill._id),
      containerName: bill.containerName,
      companyName: bill.companyName,
      products: (bill.products ?? []).map((p: any) => ({
        id: String(p._id),
        productName: p.productName,
        totalCBM: p.totalCBM,
        priceBuyCBM: p.priceBuyCBM,
        priceSellCBM: p.priceSellCBM,
        totalAmount: p.totalAmount,
        totalProfit: p.totalProfit,
      })),
      createdAt: bill.createdAt.toISOString(),
      updatedAt: bill.updatedAt.toISOString(),
    }

    return NextResponse.json({ success: true, data: mapped })
  } catch (error) {
    console.error('Carrying create/update API Error:', error)
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

