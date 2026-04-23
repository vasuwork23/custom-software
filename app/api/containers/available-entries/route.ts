import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** GET: entries with inTransitCtn > 0 and remaining CTN available to load.
 *  Query: excludeContainerId (optional) — when adding to existing container, exclude it from "already loaded" and from the list (don't show entries already in that container).
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
    const excludeContainerId = searchParams.get('excludeContainerId')?.trim()

    await connectDB()

    const entries = await BuyingEntry.find({ inTransitCtn: { $gt: 0 } })
      .sort({ product: 1, createdAt: -1 })
      .lean()
      .populate('product', 'productName')

    let entryIdsInExcludedContainer: Set<string> = new Set()
    if (excludeContainerId && mongoose.Types.ObjectId.isValid(excludeContainerId)) {
      const excluded = await Container.findById(excludeContainerId)
        .select('entries.buyingEntry')
        .lean()
      if (excluded && (excluded as { entries?: { buyingEntry: mongoose.Types.ObjectId }[] }).entries) {
        entryIdsInExcludedContainer = new Set(
          ((excluded as { entries: { buyingEntry: mongoose.Types.ObjectId }[] }).entries ?? []).map((e) =>
            e.buyingEntry.toString()
          )
        )
      }
    }

    const availableEntries = await Promise.all(
      (entries as { _id: mongoose.Types.ObjectId; product: unknown; mark?: string; entryDate?: Date; inTransitCtn?: number; cbm?: number; weight?: number }[]).map(
        async (entry) => {
          if (entryIdsInExcludedContainer.has(entry._id.toString())) return null

          const query: { 'entries.buyingEntry': mongoose.Types.ObjectId; _id?: { $ne: mongoose.Types.ObjectId } } = {
            'entries.buyingEntry': entry._id,
          }
          if (excludeContainerId && mongoose.Types.ObjectId.isValid(excludeContainerId)) {
            query._id = { $ne: new mongoose.Types.ObjectId(excludeContainerId) }
          }

          const containers = await Container.find(query)
            .select('entries.buyingEntry entries.ctnCount')
            .lean()

          const alreadyLoaded = (containers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
            (sum, c) => {
              const found = c.entries.find((e) => e.buyingEntry.toString() === entry._id.toString())
              return sum + (found?.ctnCount ?? 0)
            },
            0
          )

          const inTransit = entry.inTransitCtn ?? 0
          const remainingCtn = inTransit - alreadyLoaded
          if (remainingCtn <= 0) return null

          const product = entry.product
          const productId = typeof product === 'object' && product && product !== null && '_id' in product ? (product as { _id: mongoose.Types.ObjectId })._id : null
          const productName = typeof product === 'object' && product && product !== null && 'productName' in product ? (product as { productName?: string }).productName : '—'

          return {
            _id: entry._id,
            productId,
            productName: productName ?? '—',
            mark: entry.mark,
            entryDate: entry.entryDate,
            inTransitCtn: inTransit,
            alreadyLoaded,
            remainingCtn,
            cbmPerCtn: entry.cbm ?? 0,
            weightPerCtn: entry.weight ?? 0,
          }
        }
      )
    )

    const list = availableEntries.filter(Boolean) as {
      _id: mongoose.Types.ObjectId
      productId: mongoose.Types.ObjectId
      productName: string
      mark: string
      entryDate?: Date
      inTransitCtn: number
      alreadyLoaded: number
      remainingCtn: number
      cbmPerCtn: number
      weightPerCtn: number
    }[]

    return NextResponse.json({ success: true, data: { entries: list } })
  } catch (error) {
    console.error('Containers available-entries API Error:', error)
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
