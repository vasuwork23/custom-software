import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import MatchAlias from '@/models/MatchAlias'
import { normalize } from '@/lib/fuzzy-match'
import {
  createSellBill,
  validateSellBillInput,
  type CreateSellBillInput,
} from '@/lib/create-sell-bill'

export const dynamic = 'force-dynamic'

const MAX_BILLS_PER_BATCH = 50

interface AliasInput {
  raw: string
  targetType: 'product' | 'company' | 'bank'
  productSource?: 'china' | 'india'
  targetId: string
}

interface BatchResult {
  index: number
  success: boolean
  billId?: string
  billNumber?: number
  grandTotal?: number
  message?: string
}

/**
 * Records the free-text → catalog mappings the user confirmed, so the same
 * shorthand resolves instantly on the next paste. Never fails the request.
 */
async function saveAliases(aliases: AliasInput[], createdBy: mongoose.Types.ObjectId) {
  const seen = new Set<string>()
  for (const alias of aliases) {
    try {
      const raw = String(alias?.raw ?? '').trim()
      const targetId = String(alias?.targetId ?? '')
      if (!raw || !mongoose.Types.ObjectId.isValid(targetId)) continue
      if (!['product', 'company', 'bank'].includes(alias.targetType)) continue

      const aliasNormalized = normalize(raw)
      if (!aliasNormalized) continue

      const dedupeKey = `${alias.targetType}:${aliasNormalized}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const objectId = new mongoose.Types.ObjectId(targetId)
      const isIndia = alias.productSource === 'india'

      await MatchAlias.findOneAndUpdate(
        { aliasNormalized, targetType: alias.targetType },
        {
          $set: {
            aliasRaw: raw,
            aliasNormalized,
            targetType: alias.targetType,
            ...(alias.targetType === 'product'
              ? {
                  productSource: alias.productSource ?? 'china',
                  product: isIndia ? undefined : objectId,
                  indiaProduct: isIndia ? objectId : undefined,
                  company: undefined,
                  bankAccount: undefined,
                }
              : alias.targetType === 'bank'
                ? {
                    bankAccount: objectId,
                    company: undefined,
                    product: undefined,
                    indiaProduct: undefined,
                  }
                : {
                    company: objectId,
                    bankAccount: undefined,
                    product: undefined,
                    indiaProduct: undefined,
                  }),
            updatedBy: createdBy,
          },
          $inc: { useCount: 1 },
          $setOnInsert: { createdBy },
        },
        { upsert: true, new: true }
      )
    } catch {
      // A failed alias must never block bill creation.
    }
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
    const bills: CreateSellBillInput[] = Array.isArray(body?.bills) ? body.bills : []
    const aliases: AliasInput[] = Array.isArray(body?.aliases) ? body.aliases : []

    if (!bills.length) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'No bills to create' },
        { status: 400 }
      )
    }
    if (bills.length > MAX_BILLS_PER_BATCH) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Too many bills in one batch (${bills.length}). Maximum is ${MAX_BILLS_PER_BATCH}.`,
        },
        { status: 400 }
      )
    }

    // Validate everything up front so a bad payload fails before any writes.
    const validationErrors = bills
      .map((bill, index) => ({ index, error: validateSellBillInput(bill) }))
      .filter((v) => v.error)
    if (validationErrors.length) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Bill ${validationErrors[0].index + 1}: ${validationErrors[0].error}`,
        },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    // Sequential on purpose: FIFO consumes stock, so bills must not race.
    const results: BatchResult[] = []
    for (let index = 0; index < bills.length; index++) {
      try {
        const created = await createSellBill(bills[index], createdBy)
        results.push({
          index,
          success: true,
          billId: String(created.billId),
          billNumber: created.billNumber,
          grandTotal: created.grandTotal,
        })
      } catch (error) {
        // One failure (usually insufficient stock) must not discard the rest.
        results.push({
          index,
          success: false,
          message: error instanceof Error ? error.message : 'Failed to create bill',
        })
      }
    }

    const createdCount = results.filter((r) => r.success).length
    if (createdCount > 0 && aliases.length) await saveAliases(aliases, createdBy)

    return NextResponse.json({
      success: true,
      data: {
        results,
        createdCount,
        failedCount: results.length - createdCount,
      },
    })
  } catch (error) {
    console.error('Sell bill batch API Error:', error)
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
