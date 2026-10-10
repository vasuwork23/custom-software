import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { ensureNotViewer } from '@/lib/permissions'
import ProductInsightOverride from '@/models/ProductInsightOverride'

export const dynamic = 'force-dynamic'

const TAGS = ['none', 'discontinue', 'hold', 'competitor', 'seasonal', 'push'] as const

/** Save (or clear) your own call on a product for Product Insights. */
export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const perm = ensureNotViewer(user)
    if (!perm.ok) {
      return NextResponse.json({ success: false, error: 'Forbidden', message: perm.message }, { status: 403 })
    }

    const body = await req.json()
    const source = body.source === 'india' ? 'india' : body.source === 'china' ? 'china' : null
    const productId = String(body.productId ?? '')
    if (!source || !mongoose.Types.ObjectId.isValid(productId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', message: 'source and productId are required' },
        { status: 400 }
      )
    }
    const tag = TAGS.includes(body.tag) ? (body.tag as (typeof TAGS)[number]) : 'none'
    const adjust = Math.round(Number(body.demandAdjustPct) || 0)
    const demandAdjustPct = Math.min(300, Math.max(-100, adjust))
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''

    await connectDB()
    const filter = { source, product: new mongoose.Types.ObjectId(productId) }

    // Nothing set means back to the data's own judgement.
    if (tag === 'none' && demandAdjustPct === 0 && !note) {
      await ProductInsightOverride.deleteOne(filter)
      return NextResponse.json({ success: true, data: null })
    }

    const updatedBy = await resolveCreatedBy(user.id)
    const doc = await ProductInsightOverride.findOneAndUpdate(
      filter,
      { $set: { tag, demandAdjustPct, note: note || undefined, updatedBy } },
      { upsert: true, new: true, runValidators: true }
    ).lean()
    return NextResponse.json({ success: true, data: doc })
  } catch (error) {
    console.error('Insight override error:', error)
    return NextResponse.json(
      { success: false, error: 'Server error', message: 'Failed to save' },
      { status: 500 }
    )
  }
}
