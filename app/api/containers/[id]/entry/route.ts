import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

/** PUT: update CTN for a specific entry in the container */
export async function PUT(
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

    const body = await req.json()
    const buyingEntryId = body.buyingEntryId ?? body.buyingEntry
    const ctnCount = Number(body.ctnCount)
    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId) || !Number.isInteger(ctnCount) || ctnCount < 1) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId and ctnCount (≥1) are required' },
        { status: 400 }
      )
    }

    await connectDB()

    const container = await Container.findById(id)
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    const entryIndex = container.entries.findIndex(
      (e) => e.buyingEntry.toString() === buyingEntryId
    )
    if (entryIndex === -1) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Entry not found in this container' },
        { status: 404 }
      )
    }

    const buyingEntry = await BuyingEntry.findById(buyingEntryId).lean()
    if (!buyingEntry) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Buying entry not found' },
        { status: 400 }
      )
    }

    const inTransit = (buyingEntry as { inTransitCtn?: number }).inTransitCtn ?? 0
    const otherContainers = await Container.find({
      _id: { $ne: id },
      'entries.buyingEntry': new mongoose.Types.ObjectId(buyingEntryId),
    })
      .select('entries.buyingEntry entries.ctnCount')
      .lean()
    const loadedElsewhere = (otherContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
      (sum, c) => {
        const found = c.entries.find((e) => e.buyingEntry.toString() === buyingEntryId)
        return sum + (found?.ctnCount ?? 0)
      },
      0
    )
    const maxAllowed = inTransit - loadedElsewhere

    if (ctnCount > maxAllowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Cannot exceed ${maxAllowed} CTN (${loadedElsewhere} in other containers)`,
        },
        { status: 400 }
      )
    }

    const entry = container.entries[entryIndex]
    const cbmPerCtn = (buyingEntry as { cbm?: number }).cbm ?? 0
    const weightPerCtn = (buyingEntry as { weight?: number }).weight ?? 0
    entry.ctnCount = ctnCount
    entry.cbm = Math.round(ctnCount * cbmPerCtn * 100) / 100
    entry.weight = Math.round(ctnCount * weightPerCtn * 100) / 100

    await container.save()

    const updated = await Container.findById(id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate')
      .populate('entries.product', 'productName')

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Container entry update API Error:', error)
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

/** DELETE: remove a buying entry from the container */
export async function DELETE(
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

    let buyingEntryId: string | null = null
    try {
      const body = await req.json()
      buyingEntryId = body.buyingEntryId ?? body.buyingEntry ?? null
    } catch {
      const url = new URL(req.url)
      buyingEntryId = url.searchParams.get('buyingEntryId')
    }
    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId is required' },
        { status: 400 }
      )
    }

    await connectDB()

    const container = await Container.findById(id)
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    if (container.reachedIndiaWarehouse) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot modify entries — container has already reached India warehouse',
        },
        { status: 400 }
      )
    }

    const before = container.entries.length
    container.entries = container.entries.filter(
      (e) => e.buyingEntry.toString() !== buyingEntryId
    )
    if (container.entries.length === before) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Entry not found in this container' },
        { status: 404 }
      )
    }

    await container.save()

    const updated = await Container.findById(id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate')
      .populate('entries.product', 'productName')

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Container entry delete API Error:', error)
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

/** POST: add a new buying entry to an existing container */
export async function POST(
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

    const body = await req.json()
    const buyingEntryId = body.buyingEntryId ?? body.buyingEntry
    const ctnCount = Number(body.ctnCount)
    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId) || !Number.isInteger(ctnCount) || ctnCount < 1) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId and ctnCount (≥1) are required' },
        { status: 400 }
      )
    }

    await connectDB()

    const container = await Container.findById(id)
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    if (container.reachedIndiaWarehouse) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot add entries — container already reached warehouse',
        },
        { status: 400 }
      )
    }

    const buyingEntry = await BuyingEntry.findById(buyingEntryId).lean()
    if (!buyingEntry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    const alreadyInThisContainer = container.entries.find(
      (e) => e.buyingEntry.toString() === buyingEntryId
    )
    if (alreadyInThisContainer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'This entry is already in this container. Edit the CTN count instead.',
        },
        { status: 400 }
      )
    }

    const inTransit = (buyingEntry as { inTransitCtn?: number }).inTransitCtn ?? 0
    const otherContainers = await Container.find({
      _id: { $ne: id },
      'entries.buyingEntry': new mongoose.Types.ObjectId(buyingEntryId),
    })
      .select('entries.buyingEntry entries.ctnCount')
      .lean()
    const loadedElsewhere = (otherContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
      (sum, c) => {
        const found = c.entries.find((e) => e.buyingEntry.toString() === buyingEntryId)
        return sum + (found?.ctnCount ?? 0)
      },
      0
    )
    const maxAllowed = inTransit - loadedElsewhere
    if (ctnCount > maxAllowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Only ${maxAllowed} CTN available (${loadedElsewhere} in other containers)`,
        },
        { status: 400 }
      )
    }

    const cbmPerCtn = (buyingEntry as { cbm?: number }).cbm ?? 0
    const weightPerCtn = (buyingEntry as { weight?: number }).weight ?? 0
    container.entries.push({
      buyingEntry: new mongoose.Types.ObjectId(buyingEntryId),
      product: (buyingEntry as { product: mongoose.Types.ObjectId }).product,
      ctnCount,
      cbm: Math.round(ctnCount * cbmPerCtn * 100) / 100,
      weight: Math.round(ctnCount * weightPerCtn * 100) / 100,
    })

    await container.save()

    const updated = await Container.findById(id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate inTransitCtn')
      .populate('entries.product', 'productName')

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Container entry add API Error:', error)
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
