import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import MatchAlias from '@/models/MatchAlias'
import { normalize } from '@/lib/fuzzy-match'
import {
  createPaymentReceipt,
  validatePaymentReceiptInput,
  type CreatePaymentReceiptInput,
} from '@/lib/create-payment-receipt'

export const dynamic = 'force-dynamic'

const MAX_RECEIPTS_PER_BATCH = 200

interface AliasInput {
  raw: string
  targetType: 'company' | 'bank'
  targetId: string
}

interface BatchResult {
  index: number
  success: boolean
  receiptId?: string
  companyName?: string
  amount?: number
  message?: string
}

/** Records confirmed name → record mappings. Never fails the request. */
async function saveAliases(aliases: AliasInput[], createdBy: mongoose.Types.ObjectId) {
  const seen = new Set<string>()
  for (const alias of aliases) {
    try {
      const raw = String(alias?.raw ?? '').trim()
      const targetId = String(alias?.targetId ?? '')
      if (!raw || !mongoose.Types.ObjectId.isValid(targetId)) continue
      if (alias.targetType !== 'company' && alias.targetType !== 'bank') continue

      const aliasNormalized = normalize(raw)
      if (!aliasNormalized) continue
      const key = `${alias.targetType}:${aliasNormalized}`
      if (seen.has(key)) continue
      seen.add(key)

      const objectId = new mongoose.Types.ObjectId(targetId)
      await MatchAlias.findOneAndUpdate(
        { aliasNormalized, targetType: alias.targetType },
        {
          $set: {
            aliasRaw: raw,
            aliasNormalized,
            targetType: alias.targetType,
            ...(alias.targetType === 'bank'
              ? { bankAccount: objectId, company: undefined }
              : { company: objectId, bankAccount: undefined }),
            product: undefined,
            indiaProduct: undefined,
            updatedBy: createdBy,
          },
          $inc: { useCount: 1 },
          $setOnInsert: { createdBy },
        },
        { upsert: true, new: true }
      )
    } catch {
      // A failed alias must never block receipt creation.
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
    const receipts: CreatePaymentReceiptInput[] = Array.isArray(body?.receipts) ? body.receipts : []
    const aliases: AliasInput[] = Array.isArray(body?.aliases) ? body.aliases : []

    if (!receipts.length) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'No vouchers to create' },
        { status: 400 }
      )
    }
    if (receipts.length > MAX_RECEIPTS_PER_BATCH) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Too many vouchers in one batch (${receipts.length}). Maximum is ${MAX_RECEIPTS_PER_BATCH}.`,
        },
        { status: 400 }
      )
    }

    const validationErrors = receipts
      .map((r, index) => ({ index, error: validatePaymentReceiptInput(r) }))
      .filter((v) => v.error)
    if (validationErrors.length) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Voucher ${validationErrors[0].index + 1}: ${validationErrors[0].error}`,
        },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    // Sequential on purpose: the online path derives each new bank balance
    // from the previous transaction, so these must not race.
    const results: BatchResult[] = []
    for (let index = 0; index < receipts.length; index++) {
      try {
        const created = await createPaymentReceipt(receipts[index], createdBy)
        results.push({
          index,
          success: true,
          receiptId: String(created.receiptId),
          companyName: created.companyName,
          amount: created.amount,
        })
      } catch (error) {
        results.push({
          index,
          success: false,
          message: error instanceof Error ? error.message : 'Failed to create voucher',
        })
      }
    }

    const createdCount = results.filter((r) => r.success).length
    if (createdCount > 0 && aliases.length) await saveAliases(aliases, createdBy)

    return NextResponse.json({
      success: true,
      data: { results, createdCount, failedCount: results.length - createdCount },
    })
  } catch (error) {
    console.error('Received voucher batch API Error:', error)
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
