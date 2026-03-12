import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BuyingEntry from '@/models/BuyingEntry'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import Product from '@/models/Product'
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
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await (await import('@/lib/auth')).resolveCreatedBy(user.id)

    const entry = await BuyingEntry.findById(id)
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Buying entry not found' },
        { status: 404 }
      )
    }

    if (!entry.isLocked) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Entry is not locked' },
        { status: 400 }
      )
    }

    const previousLockedAmount = entry.lockedAmount ?? 0

    // Step 1: Credit back FULL locked amount to China Bank
    if (previousLockedAmount > 0) {
      const lastTx = await ChinaBankTransaction.findOne().sort({ createdAt: -1 }).select('balanceAfter').lean()
      const lastBalance = lastTx?.balanceAfter ?? 0
      const product = await Product.findById(entry.product).select('productName').lean()
      await ChinaBankTransaction.create({
        type: 'reversal',
        amount: previousLockedAmount,
        balanceAfter: lastBalance + previousLockedAmount,
        buyingEntry: entry._id,
        reference: `Unlock: ${product?.productName ?? entry.mark ?? 'Product'} — reversal of lock amount`,
        transactionDate: new Date(),
        sortOrder: 1,
        createdBy,
      })
    }

    // Step 2: Clear ALL lock fields — reset to zero so re-lock debits the correct full amount
    entry.isLocked = false
    entry.lockedAmount = 0
    entry.lockedCtn = 0
    entry.lockedAt = undefined
    await entry.save()

    const updated = await BuyingEntry.findById(id).lean().populate('product', 'productName')
    return NextResponse.json({
      success: true,
      data: updated,
      message:
        previousLockedAmount > 0
          ? `Unlocked. China Bank credited ₹${previousLockedAmount.toLocaleString('en-IN')}`
          : 'Entry unlocked',
      creditedAmount: previousLockedAmount,
    })
  } catch (error) {
    console.error('Buying entry unlock API Error:', error)
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
