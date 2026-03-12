import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate inTransitCtn availableCtn')
      .populate('entries.product', 'productName')

    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    const entriesWithMax = await Promise.all(
      ((container as { entries?: { buyingEntry: unknown; product: unknown; ctnCount: number; cbm: number; weight?: number }[] }).entries ?? []).map(
        async (entry) => {
          const buyingEntryId =
            typeof entry.buyingEntry === 'object' && entry.buyingEntry && entry.buyingEntry !== null && '_id' in entry.buyingEntry
              ? (entry.buyingEntry as { _id: mongoose.Types.ObjectId; inTransitCtn?: number })._id
              : entry.buyingEntry
          const inTransit =
            typeof entry.buyingEntry === 'object' && entry.buyingEntry && entry.buyingEntry !== null && 'inTransitCtn' in entry.buyingEntry
              ? (entry.buyingEntry as { inTransitCtn?: number }).inTransitCtn ?? 0
              : 0
          const otherContainers = await Container.find({
            _id: { $ne: id },
            'entries.buyingEntry': buyingEntryId,
          })
            .select('entries.buyingEntry entries.ctnCount')
            .lean()
          const loadedElsewhere = (otherContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
            (sum, c) => {
              const found = c.entries.find((e) => e.buyingEntry.toString() === (typeof buyingEntryId === 'object' ? buyingEntryId.toString() : buyingEntryId))
              return sum + (found?.ctnCount ?? 0)
            },
            0
          )
          const maxAllowedCtn = inTransit - loadedElsewhere
          return { ...entry, maxAllowedCtn: Math.max(0, maxAllowedCtn) }
        }
      )
    )

    const data = { ...container, entries: entriesWithMax }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Container get API Error:', error)
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

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    const container = await Container.findById(id)
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    const previousWarehouse = container.reachedIndiaWarehouse

    if (body.containerName != null && typeof body.containerName === 'string' && body.containerName.trim()) {
      container.containerName = body.containerName.trim()
    }
    if (body.remarks !== undefined) container.remarks = body.remarks ? String(body.remarks).trim() : undefined
    if (body.status != null && ['loading', 'in_transit', 'customs_clearance', 'arrived'].includes(body.status)) {
      container.status = body.status
    }
    if (body.loadingDate !== undefined) container.loadingDate = body.loadingDate ? new Date(body.loadingDate) : undefined
    if (body.dispatchDate !== undefined) container.dispatchDate = body.dispatchDate ? new Date(body.dispatchDate) : undefined
    if (body.estimatedArrival !== undefined) container.estimatedArrival = body.estimatedArrival ? new Date(body.estimatedArrival) : undefined
    if (body.arrivedDate !== undefined) container.arrivedDate = body.arrivedDate ? new Date(body.arrivedDate) : undefined

    if (body.entries != null && Array.isArray(body.entries)) {
      const entries: { buyingEntry: mongoose.Types.ObjectId; product: mongoose.Types.ObjectId; ctnCount: number; cbm: number; weight: number }[] = []
      for (const item of body.entries) {
        const entryId = item.buyingEntryId ?? item.buyingEntry
        const ctnCount = Number(item.ctnCount)
        if (!entryId || !mongoose.Types.ObjectId.isValid(entryId) || !Number.isInteger(ctnCount) || ctnCount < 1) continue
        const entry = await BuyingEntry.findById(entryId).lean()
        if (!entry) continue
        const inTransit = (entry as { inTransitCtn?: number }).inTransitCtn ?? 0
        const otherContainers = await Container.find({
          _id: { $ne: container._id },
          'entries.buyingEntry': new mongoose.Types.ObjectId(entryId),
        }).lean()
        const loadedElsewhere = (otherContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
          (sum, c) => {
            const found = c.entries.find((e) => e.buyingEntry.toString() === entryId)
            return sum + (found?.ctnCount ?? 0)
          },
          0
        )
        const remainingToLoad = inTransit - loadedElsewhere
        if (ctnCount > remainingToLoad) continue
        const cbmPerCtn = (entry as { cbm?: number }).cbm ?? 0
        const weightPerCtn = (entry as { weight?: number }).weight ?? 0
        entries.push({
          buyingEntry: new mongoose.Types.ObjectId(entryId),
          product: (entry as { product: mongoose.Types.ObjectId }).product,
          ctnCount,
          cbm: Math.round(ctnCount * cbmPerCtn * 100) / 100,
          weight: Math.round(ctnCount * weightPerCtn * 100) / 100,
        })
      }
      container.entries = entries
    }

    if (body.reachedIndiaWarehouse === true && !previousWarehouse) {
      for (const e of container.entries) {
        const entry = await BuyingEntry.findById(e.buyingEntry)
        if (!entry) continue
        const ctn = e.ctnCount
        entry.inTransitCtn = parseFloat(Math.max(0, (entry.inTransitCtn ?? 0) - ctn).toFixed(2))
        entry.availableCtn = parseFloat(((entry.availableCtn ?? 0) + ctn).toFixed(2))
        await entry.save()
      }
      container.reachedIndiaWarehouse = true
      container.warehouseDate = new Date()
    }

    await container.save()

    const updated = await Container.findById(id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate inTransitCtn')
      .populate('entries.product', 'productName')
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Container update API Error:', error)
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
    if (user.role !== 'owner' && user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner or Admin can delete containers' },
        { status: 403 }
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

    const container = await Container.findById(id).lean()
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    const status = (container as { status?: string }).status
    const reachedIndiaWarehouse = (container as { reachedIndiaWarehouse?: boolean }).reachedIndiaWarehouse

    if (reachedIndiaWarehouse) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message:
            'Cannot delete container that has already reached India warehouse. This would affect inventory records.',
        },
        { status: 400 }
      )
    }

    const isOwner = user.role === 'owner'
    if (status !== 'loading' && !isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: `Cannot delete container with status "${status}". Only containers in Loading status can be deleted. Contact Owner to force delete.`,
        },
        { status: 403 }
      )
    }

    await Container.findByIdAndDelete(id)

    return NextResponse.json({ success: true, data: { deleted: id }, message: 'Container deleted' })
  } catch (error) {
    console.error('Container delete API Error:', error)
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
