import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Container from '@/models/Container'
import BuyingEntry from '@/models/BuyingEntry'
import { ensureOwnerOrAdmin } from '@/lib/permissions'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

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
    const check = ensureOwnerOrAdmin(user)
    if (!check.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: check.message },
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

    const container = await Container.findById(id)
    if (!container) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Container not found' },
        { status: 404 }
      )
    }

    if (container.status !== 'arrived') {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Container status must be "arrived" before confirming warehouse arrival' },
        { status: 400 }
      )
    }

    if (container.reachedIndiaWarehouse) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Warehouse arrival already recorded' },
        { status: 400 }
      )
    }

    const updatedEntries: { productName: string; ctnMoved: number }[] = []

    for (const e of container.entries) {
      const entry = await BuyingEntry.findById(e.buyingEntry).populate('product', 'productName')
      if (!entry) continue
      const ctn = e.ctnCount
      entry.inTransitCtn = parseFloat(Math.max(0, (entry.inTransitCtn ?? 0) - ctn).toFixed(2))
      entry.availableCtn = parseFloat(((entry.availableCtn ?? 0) + ctn).toFixed(2))
      await entry.save()
      const productName = (entry.product as { productName?: string })?.productName ?? '—'
      updatedEntries.push({ productName, ctnMoved: ctn })
    }

    container.reachedIndiaWarehouse = true
    container.warehouseDate = new Date()
    await container.save()

    const updated = await Container.findById(id)
      .lean()
      .populate('entries.buyingEntry', 'mark entryDate')
      .populate('entries.product', 'productName')

    return NextResponse.json({
      success: true,
      data: { container: updated, updatedEntries },
    })
  } catch (error) {
    console.error('Container warehouse arrival API Error:', error)
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
