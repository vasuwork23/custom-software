import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    if (user.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Only Owner can run migration fixes' },
        { status: 403 }
      )
    }

    await connectDB()

    const entries = await BuyingEntry.find({}).exec()
    let migrated = 0

    for (const entry of entries) {
      // @ts-expect-error legacy field
      const legacyStatus: string | undefined = (entry as any).warehouseStatus

      if (legacyStatus === 'india_warehouse') {
        entry.chinaWarehouseReceived = 'yes'
        entry.chinaWarehouseCtn = 0
        entry.inTransitCtn = 0
        // availableCtn stays as-is (already India stock)
      } else if (legacyStatus === 'china_warehouse') {
        entry.chinaWarehouseReceived = 'no'
        entry.chinaWarehouseCtn = entry.totalCtn
        entry.inTransitCtn = 0
        entry.availableCtn = 0
      } else if (legacyStatus === 'in_transit') {
        entry.chinaWarehouseReceived = 'no'
        entry.chinaWarehouseCtn = 0
        entry.inTransitCtn = entry.totalCtn
        entry.availableCtn = 0
      } else if (!entry.chinaWarehouseReceived) {
        // Default fallback if already migrated but missing flag
        entry.chinaWarehouseReceived = 'no'
      }

      if (!entry.mark || !entry.mark.trim()) {
        const d = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate)
        const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`
        entry.mark = formatted
      }

      // Remove legacy field if present
      // @ts-expect-error legacy field removal
      if ((entry as any).warehouseStatus !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (entry as any).warehouseStatus
      }

      await entry.save()
      migrated += 1
    }

    return NextResponse.json({
      success: true,
      data: { migrated },
      message: 'BuyingEntry warehouse fields migrated successfully',
    })
  } catch (error) {
    console.error('Fix migrate warehouse fields API Error:', error)
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

