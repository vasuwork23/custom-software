import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import Product from '@/models/Product'
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
    const status = searchParams.get('status')?.trim()

    await connectDB()

    const filter: Record<string, string> = {}
    if (status && ['loading', 'in_transit', 'customs_clearance', 'arrived'].includes(status)) {
      filter.status = status
    }

    const containers = await Container.find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .populate('createdBy', 'fullName')

    const containerIds = containers.map((c) => c._id)
    const entriesWithDetails =
      containerIds.length > 0
        ? await Container.aggregate([
      { $match: { _id: { $in: containerIds } } },
      { $unwind: '$entries' },
      {
        $lookup: {
          from: 'buyingentries',
          localField: 'entries.buyingEntry',
          foreignField: '_id',
          as: 'entryDoc',
        },
      },
      { $unwind: { path: '$entryDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'products',
          localField: 'entries.product',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id',
          entries: {
            $push: {
              buyingEntry: '$entries.buyingEntry',
              product: '$entries.product',
              productName: '$productDoc.productName',
              mark: '$entryDoc.mark',
              entryDate: '$entryDoc.entryDate',
              ctnCount: '$entries.ctnCount',
              cbm: '$entries.cbm',
              weight: '$entries.weight',
            },
          },
        },
      },
    ])
        : []

    const entriesByContainer = Object.fromEntries(
      entriesWithDetails.map((e: { _id: mongoose.Types.ObjectId; entries: unknown[] }) => [
        String(e._id),
        e.entries,
      ])
    )

    const list = (containers as { _id: mongoose.Types.ObjectId; [k: string]: unknown }[]).map((c) => ({
      ...c,
      entries: entriesByContainer[String(c._id)] ?? [],
    }))

    const [countsAgg, summaryAgg] = await Promise.all([
      Container.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Container.aggregate([{ $group: { _id: null, totalCtn: { $sum: '$totalCtn' } } }]),
    ])
    const statusCounts = Object.fromEntries((countsAgg as { _id: string; n: number }[]).map((r) => [r._id, r.n]))
    const counts = {
      all: (await Container.countDocuments()) || 0,
      loading: statusCounts.loading ?? 0,
      in_transit: statusCounts.in_transit ?? 0,
      customs_clearance: statusCounts.customs_clearance ?? 0,
      arrived: statusCounts.arrived ?? 0,
      inWarehouse: await Container.countDocuments({ reachedIndiaWarehouse: true }),
    }
    const summary = {
      totalCtn: (summaryAgg[0] as { totalCtn?: number })?.totalCtn ?? 0,
    }

    return NextResponse.json({
      success: true,
      data: {
        containers: list,
        counts,
        summary,
      },
    })
  } catch (error) {
    console.error('Containers list API Error:', error)
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
    const containerId = typeof body.containerId === 'string' ? body.containerId.trim() : ''
    const containerName = typeof body.containerName === 'string' ? body.containerName.trim() : ''
    if (!containerId || !containerName) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'containerId and containerName are required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const existing = await Container.findOne({ containerId }).lean()
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Container ID already exists' },
        { status: 400 }
      )
    }

    const entriesInput = Array.isArray(body.entries) ? body.entries : []
    const entries: { buyingEntry: mongoose.Types.ObjectId; product: mongoose.Types.ObjectId; ctnCount: number; cbm: number; weight: number }[] = []

    for (const item of entriesInput) {
      const entryId = item.buyingEntryId ?? item.buyingEntry
      const ctnCount = Number(item.ctnCount)
      if (!entryId || !mongoose.Types.ObjectId.isValid(entryId) || !Number.isInteger(ctnCount) || ctnCount < 1) {
        continue
      }
      const entry = await BuyingEntry.findById(entryId).lean()
      if (!entry) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: `Buying entry ${entryId} not found` },
          { status: 400 }
        )
      }
      const inTransit = (entry as { inTransitCtn?: number }).inTransitCtn ?? 0
      const existingContainers = await Container.find({
        'entries.buyingEntry': new mongoose.Types.ObjectId(entryId),
      }).lean()
      const alreadyLoaded = (existingContainers as { entries: { buyingEntry: mongoose.Types.ObjectId; ctnCount: number }[] }[]).reduce(
        (sum, c) => {
          const found = c.entries.find(
            (e) => e.buyingEntry.toString() === entryId
          )
          return sum + (found?.ctnCount ?? 0)
        },
        0
      )
      const remainingToLoad = inTransit - alreadyLoaded
      if (ctnCount > remainingToLoad) {
        const mark = (entry as { mark?: string }).mark ?? 'Entry'
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            message: `Entry "${mark}": Only ${remainingToLoad} CTN available. ${alreadyLoaded} CTN already loaded in other containers.`,
          },
          { status: 400 }
        )
      }
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

    const status = ['loading', 'in_transit', 'customs_clearance', 'arrived'].includes(body.status)
      ? body.status
      : 'loading'

    const container = await Container.create({
      containerId,
      containerName,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() || undefined : undefined,
      status,
      loadingDate: body.loadingDate ? new Date(body.loadingDate) : undefined,
      dispatchDate: body.dispatchDate ? new Date(body.dispatchDate) : undefined,
      estimatedArrival: body.estimatedArrival ? new Date(body.estimatedArrival) : undefined,
      arrivedDate: body.arrivedDate ? new Date(body.arrivedDate) : undefined,
      entries,
      createdBy,
    })

    const created = await Container.findById(container._id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate')
      .populate('entries.product', 'productName')
    return NextResponse.json({ success: true, data: created })
  } catch (error) {
    console.error('Container create API Error:', error)
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
