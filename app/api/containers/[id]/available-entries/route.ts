import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** GET: entries that can be added to this container (not already in it, with remaining CTN) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid container id' },
        { status: 400 }
      )
    }

    await connectDB()

    const container = await Container.findById(id)
      .select('entries.buyingEntry')
      .lean()
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    const alreadyInContainer = new Set(
      ((container as { entries?: { buyingEntry: mongoose.Types.ObjectId }[] }).entries ?? []).map((e) =>
        e.buyingEntry.toString()
      )
    )

    const entries = await BuyingEntry.find({ inTransitCtn: { $gt: 0 } })
      .sort({ product: 1, createdAt: -1 })
      .lean()
      .populate('product', 'productName')

    const entryIds = (entries as { _id: mongoose.Types.ObjectId }[])
      .filter((e) => !alreadyInContainer.has(e._id.toString()))
      .map((e) => e._id)

    if (entryIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          entries: [],
        },
      })
    }

    const otherContainers = await Container.find({
      _id: { $ne: id },
      'entries.buyingEntry': { $in: entryIds },
    })
      .select('entries.buyingEntry entries.ctnCount')
      .lean()

    const loadedByEntry = new Map<string, number>()
    for (const c of otherContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]) {
      for (const e of c.entries) {
        const idStr = e.buyingEntry.toString()
        loadedByEntry.set(idStr, (loadedByEntry.get(idStr) ?? 0) + (e.ctnCount ?? 0))
      }
    }

    const list = (entries as { _id: mongoose.Types.ObjectId; product: unknown; mark?: string; entryDate?: Date; inTransitCtn?: number; cbm?: number; weight?: number }[])
      .filter((e) => !alreadyInContainer.has(e._id.toString()))
      .map((e) => {
        const idStr = e._id.toString()
        const inTransit = e.inTransitCtn ?? 0
        const loadedElsewhere = loadedByEntry.get(idStr) ?? 0
        const remainingCtn = inTransit - loadedElsewhere
        if (remainingCtn <= 0) return null
        const product = e.product
        const productId = typeof product === 'object' && product && product !== null && '_id' in product ? (product as { _id: mongoose.Types.ObjectId })._id : product
        const productName = typeof product === 'object' && product && product !== null && 'productName' in product ? (product as { productName?: string }).productName : '—'
        return {
          _id: e._id,
          productId,
          productName: productName ?? '—',
          mark: e.mark,
          entryDate: e.entryDate,
          inTransitCtn: inTransit,
          remainingCtn,
          cbmPerCtn: e.cbm ?? 0,
          weightPerCtn: e.weight ?? 0,
        }
      })
      .filter(Boolean) as { _id: mongoose.Types.ObjectId; productId: mongoose.Types.ObjectId; productName: string; mark: string; entryDate?: Date; inTransitCtn: number; remainingCtn: number; cbmPerCtn: number; weightPerCtn: number }[]

    return NextResponse.json({ success: true, data: { entries: list } })
  } catch (error) {
    console.error('Container available entries API Error:', error)
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
