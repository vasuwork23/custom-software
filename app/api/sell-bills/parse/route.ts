import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import MatchAlias from '@/models/MatchAlias'
import {
  getSellableProducts,
  getProductDiagnostics,
  explainNoStock,
  type SellableProduct,
  type ProductDiagnostic,
} from '@/lib/product-catalog'
import { parseMessages, type ParsedItem } from '@/lib/message-parser'
import { matchOne, normalize, type MatchConfidence } from '@/lib/fuzzy-match'

export const dynamic = 'force-dynamic'

const MAX_INPUT_CHARS = 20000

interface CompanyLite {
  _id: string
  companyName: string
}

interface BankLite {
  _id: string
  accountName: string
}

interface DraftItem {
  sourceLine: string
  productRaw: string
  qty: number
  unit: 'ctn' | 'pcs'
  productValue: string | null // "china:<id>" | "india:<id>"
  productLabel: string | null
  qtyPerCtn: number
  availableCtn: number
  availablePcs: number
  ctn: number
  pcs: number
  ratePerPcs: number | null
  confidence: MatchConfidence | null
  alternatives: { value: string; label: string; score: number }[]
  warnings: string[]
}

interface DraftBill {
  key: string
  sourceText: string
  billDate: string
  companyRaw: string | null
  companyId: string | null // ObjectId | 'cashbook' | 'bankaccount'
  companyName: string | null
  companyConfidence: MatchConfidence | null
  companyAlternatives: { _id: string; companyName: string; score: number }[]
  assumedCashbook: boolean
  bankAccountRaw: string | null
  bankAccountId: string | null
  bankAccountName: string | null
  bankConfidence: MatchConfidence | null
  notes: string
  items: DraftItem[]
  warnings: string[]
}

/** Resolves ctn/pcs quantities into both units using the product's carton size. */
function resolveQuantities(item: ParsedItem, qtyPerCtn: number) {
  if (item.unit === 'ctn') {
    const ctn = item.qty
    const pcs = qtyPerCtn > 0 ? Math.round(ctn * qtyPerCtn) : 0
    return { ctn, pcs }
  }
  const pcs = Math.round(item.qty)
  const ctn = qtyPerCtn > 0 ? parseFloat((pcs / qtyPerCtn).toFixed(4)) : 0
  return { ctn, pcs }
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
    const text = typeof body?.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Paste a message to parse' },
        { status: 400 }
      )
    }
    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: `Message is too long (${text.length} chars). Paste up to ${MAX_INPUT_CHARS} characters at a time.`,
        },
        { status: 400 }
      )
    }

    await connectDB()

    const parsed = parseMessages(text)
    if (!parsed.bills.length) {
      return NextResponse.json({
        success: true,
        data: { bills: [], unparsed: parsed.unparsed },
      })
    }

    const [companiesRaw, banksRaw, products, aliases] = await Promise.all([
      Company.find({}).select('companyName').sort({ companyName: 1 }).lean(),
      BankAccount.find({ type: 'online' }).select('accountName').sort({ accountName: 1 }).lean(),
      getSellableProducts(),
      MatchAlias.find({}).lean(),
    ])

    const companies: CompanyLite[] = companiesRaw.map((c) => ({
      _id: String(c._id),
      companyName: c.companyName,
    }))
    const banks: BankLite[] = banksRaw.map((b) => ({
      _id: String(b._id),
      accountName: (b as { accountName?: string }).accountName ?? '',
    }))

    // Previously-confirmed spellings win outright over fuzzy scoring.
    const productAliasByName = new Map<string, string[]>()
    const companyAliasById = new Map<string, string[]>()
    for (const a of aliases) {
      if (a.targetType === 'product') {
        const id = a.productSource === 'india' ? a.indiaProduct : a.product
        if (!id) continue
        const key = `${a.productSource ?? 'china'}:${String(id)}`
        productAliasByName.set(key, [...(productAliasByName.get(key) ?? []), a.aliasRaw])
      } else if (a.company) {
        const key = String(a.company)
        companyAliasById.set(key, [...(companyAliasById.get(key) ?? []), a.aliasRaw])
      }
    }

    const aliasExactProduct = new Map<string, string>()
    const aliasExactCompany = new Map<string, string>()
    const aliasExactBank = new Map<string, string>()
    const bankAliasById = new Map<string, string[]>()
    for (const a of aliases) {
      if (a.targetType === 'product') {
        const id = a.productSource === 'india' ? a.indiaProduct : a.product
        if (id) aliasExactProduct.set(a.aliasNormalized, `${a.productSource ?? 'china'}:${String(id)}`)
      } else if (a.targetType === 'company' && a.company) {
        aliasExactCompany.set(a.aliasNormalized, String(a.company))
      } else if (a.targetType === 'bank' && a.bankAccount) {
        aliasExactBank.set(a.aliasNormalized, String(a.bankAccount))
        const key = String(a.bankAccount)
        bankAliasById.set(key, [...(bankAliasById.get(key) ?? []), a.aliasRaw])
      }
    }

    const productByValue = new Map<string, SellableProduct>(products.map((p) => [p.value, p]))

    // Loaded only if some product name fails to match, so the normal path pays nothing.
    // The promise (not the result) is memoised: items resolve concurrently, so
    // caching the result would let several callers each start their own load.
    const sellableIds = new Set(products.map((p) => `${p.source}:${p.productId}`))
    let diagnosticsPromise: Promise<ProductDiagnostic[]> | null = null
    const loadDiagnostics = (): Promise<ProductDiagnostic[]> => {
      if (!diagnosticsPromise) {
        diagnosticsPromise = getProductDiagnostics().then((all) =>
          all.filter((d) => !sellableIds.has(`${d.source}:${d.productId}`))
        )
      }
      return diagnosticsPromise
    }
    const diagnoseMissing = async (productRaw: string): Promise<string> => {
      const diagnostics = await loadDiagnostics()
      const res = matchOne(productRaw, diagnostics, (d) => [d.productName], { minScore: 0.6 })
      if (!res.best) return `No in-stock product matches "${productRaw}" — pick one manually`
      return `Matches "${res.best.item.productName}", but ${explainNoStock(res.best.item)} — pick another product or fix its stock first`
    }
    const companyById = new Map<string, CompanyLite>(companies.map((c) => [c._id, c]))
    const bankById = new Map<string, BankLite>(banks.map((b) => [b._id, b]))

    const bills: DraftBill[] = await Promise.all(parsed.bills.map(async (b, index) => {
      const warnings: string[] = []

      // ── Company / payment-mode resolution ─────────────────────────────────
      // "Cashbook" or "cash" on its own line means a cash sale; "bankbook"
      // means a bank sale, with the following line naming the bank account.
      let companyId: string | null = null
      let companyName: string | null = null
      let companyConfidence: MatchConfidence | null = null
      let companyAlternatives: { _id: string; companyName: string; score: number }[] = []
      let bankAccountId: string | null = null
      let bankAccountName: string | null = null
      let bankConfidence: MatchConfidence | null = null

      if (b.paymentMode === 'cashbook') {
        companyId = 'cashbook'
        companyName = 'Cashbook'
        companyConfidence = 'exact'
      } else if (b.paymentMode === 'bank') {
        companyId = 'bankaccount'
        companyName = 'Bank Account'
        companyConfidence = 'exact'

        if (b.bankAccountRaw) {
          const aliasHit = aliasExactBank.get(normalize(b.bankAccountRaw))
          const aliasBank = aliasHit ? bankById.get(aliasHit) : undefined
          if (aliasBank) {
            bankAccountId = aliasBank._id
            bankAccountName = aliasBank.accountName
            bankConfidence = 'exact'
          } else {
            const res = matchOne(b.bankAccountRaw, banks, (bank) => [
              bank.accountName,
              ...(bankAliasById.get(bank._id) ?? []),
            ])
            if (res.best) {
              bankAccountId = res.best.item._id
              bankAccountName = res.best.item.accountName
              bankConfidence = res.best.confidence
            }
          }
        }

        if (!b.bankAccountRaw) {
          warnings.push('Bank sale, but no account name in the message — pick one')
        } else if (!bankAccountId) {
          warnings.push(`"${b.bankAccountRaw}" is not one of your online bank accounts — pick one`)
        } else if (bankConfidence === 'low' || bankConfidence === 'medium') {
          warnings.push(
            `Bank account matched loosely ("${b.bankAccountRaw}" → ${bankAccountName}) — please confirm`
          )
        }
      } else if (b.companyRaw) {
        const aliasHit = aliasExactCompany.get(normalize(b.companyRaw))
        const aliasCompany = aliasHit ? companyById.get(aliasHit) : undefined
        if (aliasCompany) {
          companyId = aliasCompany._id
          companyName = aliasCompany.companyName
          companyConfidence = 'exact'
        } else {
          const res = matchOne(b.companyRaw, companies, (c) => [
            c.companyName,
            ...(companyAliasById.get(c._id) ?? []),
          ])
          if (res.best) {
            companyId = res.best.item._id
            companyName = res.best.item.companyName
            companyConfidence = res.best.confidence
          }
          companyAlternatives = res.alternatives.map((a) => ({
            _id: a.item._id,
            companyName: a.item.companyName,
            score: Math.round(a.score * 100) / 100,
          }))
          if (res.ambiguous && res.best) {
            const tied = [res.best.item.companyName, res.alternatives[0]?.item.companyName]
              .filter(Boolean)
              .join('" or "')
            warnings.push(`"${b.companyRaw}" could be "${tied}" — pick the right one`)
          }
        }
      }

      if (b.paymentMode === 'company') {
        if (!b.companyRaw) warnings.push('No company name found in this message')
        else if (!companyId) warnings.push(`"${b.companyRaw}" is not in your companies — add it or pick one`)
        else if (companyConfidence === 'low' || companyConfidence === 'medium') {
          warnings.push(`Company matched loosely ("${b.companyRaw}" → ${companyName}) — please confirm`)
        }
      }

      // ── Item resolution ───────────────────────────────────────────────────
      const items: DraftItem[] = await Promise.all(b.items.map(async (it) => {
        const itemWarnings: string[] = []
        let productValue: string | null = null
        let confidence: MatchConfidence | null = null
        let alternatives: { value: string; label: string; score: number }[] = []

        const aliasHit = aliasExactProduct.get(normalize(it.productRaw))
        if (aliasHit && productByValue.has(aliasHit)) {
          productValue = aliasHit
          confidence = 'exact'
        } else {
          const res = matchOne(it.productRaw, products, (p) => [
            p.productName,
            ...(productAliasByName.get(p.value) ?? []),
          ])
          if (res.best) {
            productValue = res.best.item.value
            confidence = res.best.confidence
          }
          alternatives = res.alternatives.map((a) => ({
            value: a.item.value,
            label: a.item.label,
            score: Math.round(a.score * 100) / 100,
          }))
          if (res.ambiguous && res.best) {
            const tied = [res.best.item.productName, res.alternatives[0]?.item.productName]
              .filter(Boolean)
              .join('" or "')
            itemWarnings.push(`"${it.productRaw}" could be "${tied}" — pick the right one`)
          }
        }

        const product = productValue ? productByValue.get(productValue) ?? null : null
        const qtyPerCtn = product?.qtyPerCtn ?? 0
        const { ctn, pcs } = resolveQuantities(it, qtyPerCtn)

        if (!product) {
          itemWarnings.push(await diagnoseMissing(it.productRaw))
        } else {
          const alreadyFlagged = itemWarnings.some((w) => w.includes('could be'))
          if (!alreadyFlagged && (confidence === 'low' || confidence === 'medium')) {
            itemWarnings.push(`Matched loosely to "${product.productName}" — please confirm`)
          }
          if (qtyPerCtn <= 0) itemWarnings.push('Carton size unknown for this product — enter PCS directly')
          if (pcs > product.availablePcs) {
            itemWarnings.push(`Only ${product.availablePcs} pcs in stock (needs ${pcs})`)
          }
        }
        if (it.rate == null) itemWarnings.push('No rate found in the message — enter it')

        return {
          sourceLine: it.sourceLine,
          productRaw: it.productRaw,
          qty: it.qty,
          unit: it.unit,
          productValue,
          productLabel: product?.label ?? null,
          qtyPerCtn,
          availableCtn: product?.availableCtn ?? 0,
          availablePcs: product?.availablePcs ?? 0,
          ctn,
          pcs,
          ratePerPcs: it.rate,
          confidence,
          alternatives,
          warnings: itemWarnings,
        }
      }))

      return {
        key: `draft-${index}`,
        sourceText: b.sourceText,
        billDate: b.billDate ?? new Date().toISOString().slice(0, 10),
        companyRaw: b.companyRaw,
        companyId,
        companyName,
        companyConfidence,
        companyAlternatives,
        assumedCashbook: b.assumedCashbook,
        bankAccountRaw: b.bankAccountRaw,
        bankAccountId,
        bankAccountName,
        bankConfidence,
        notes: b.notes.join('\n'),
        items,
        warnings,
      }
    }))

    return NextResponse.json({
      success: true,
      data: { bills, unparsed: parsed.unparsed },
    })
  } catch (error) {
    console.error('Sell bill parse API Error:', error)
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
