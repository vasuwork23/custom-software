import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import Container from '@/models/Container'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** GET: entries with inTransitCtn > 0 and remaining CTN not yet loaded in any container */
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

    const entries = await BuyingEntry.find({
      inTransitCtn: { $gt: 0 },
    })
      .sort({ product: 1, createdAt: -1 })
      .lean()
      .populate('product', 'productName')

    const entryIds = (entries as { _id: mongoose.Types.ObjectId }[]).map((e) => e._id)
    const containersWithEntries = await Container.find({
      'entries.buyingEntry': { $in: entryIds },
    })
      .select('entries.buyingEntry entries.ctnCount')
      .lean()

    const alreadyLoadedByEntry = new Map<string, number>()
    for (const c of containersWithEntries as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]) {
      for (const e of c.entries) {
        const id = e.buyingEntry.toString()
        alreadyLoadedByEntry.set(id, (alreadyLoadedByEntry.get(id) ?? 0) + (e.ctnCount ?? 0))
      }
    }

    const list = (entries as { _id: mongoose.Types.ObjectId; product: mongoose.Types.ObjectId | { _id: mongoose.Types.ObjectId; productName?: string }; mark?: string; entryDate?: Date; inTransitCtn?: number; cbm?: number; weight?: number }[]).map((e) => {
      const entryIdStr = e._id.toString()
      const alreadyLoaded = alreadyLoadedByEntry.get(entryIdStr) ?? 0
      const inTransit = e.inTransitCtn ?? 0
      const remaining = inTransit - alreadyLoaded
      if (remaining <= 0) return null
      const product = e.product
      const productId = typeof product === 'object' && product && '_id' in product ? product._id : product
      const productName = typeof product === 'object' && product && 'productName' in product ? product.productName : '—'
      return {
        _id: e._id,
        productId,
        productName: productName ?? '—',
        mark: e.mark,
        entryDate: e.entryDate,
        inTransitCtn: inTransit,
        cbmPerCtn: e.cbm ?? 0,
        weightPerCtn: e.weight ?? 0,
      }
    }).filter(Boolean) as { _id: mongoose.Types.ObjectId; productId: mongoose.Types.ObjectId; productName: string; mark: string; entryDate?: Date; inTransitCtn: number; cbmPerCtn: number; weightPerCtn: number }[]

    return NextResponse.json({ success: true, data: { entries: list } })
  } catch (error) {
    console.error('Available for container API Error:', error)
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
