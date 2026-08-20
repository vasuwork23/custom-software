import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import MatchAlias from '@/models/MatchAlias'
import { parseReceiptMessages } from '@/lib/receipt-parser'
import { matchOne, normalize, type MatchConfidence } from '@/lib/fuzzy-match'

export const dynamic = 'force-dynamic'

const MAX_INPUT_CHARS = 20000

interface CompanyLite {
  _id: string
  companyName: string
  outstanding: number
}

interface BankLite {
  _id: string
  accountName: string
}

interface DraftReceipt {
  key: string
  sourceLine: string
  paymentDate: string
  companyRaw: string
  companyId: string | null
  companyName: string | null
  companyOutstanding: number | null
  companyConfidence: MatchConfidence | null
  amount: number
  paymentMode: 'cash' | 'online'
  bankAccountRaw: string | null
  bankAccountId: string | null
  bankAccountName: string | null
  bankConfidence: MatchConfidence | null
  remark: string
  warnings: string[]
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

    const parsed = parseReceiptMessages(text)
    if (!parsed.receipts.length) {
      return NextResponse.json({ success: true, data: { receipts: [], unparsed: parsed.unparsed } })
    }

    const [companiesRaw, banksRaw, aliases] = await Promise.all([
      Company.find({}).select('companyName openingBalance').sort({ companyName: 1 }).lean(),
      BankAccount.find({ type: 'online' }).select('accountName').sort({ accountName: 1 }).lean(),
      MatchAlias.find({ targetType: { $in: ['company', 'bank'] } }).lean(),
    ])

    // Outstanding is derived, not stored — same formula as the companies list:
    // billed - received + openingBalance.
    const companyIds = companiesRaw.map((c) => c._id)
    const [billedAgg, receivedAgg] = await Promise.all([
      SellBill.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
      ]),
      PaymentReceipt.aggregate([
        { $match: { company: { $in: companyIds } } },
        { $group: { _id: '$company', total: { $sum: '$amount' } } },
      ]),
    ])
    const billedBy = new Map(billedAgg.map((r) => [String(r._id), r.total as number]))
    const receivedBy = new Map(receivedAgg.map((r) => [String(r._id), r.total as number]))

    const companies: CompanyLite[] = companiesRaw.map((c) => {
      const id = String(c._id)
      const billed = billedBy.get(id) ?? 0
      const received = receivedBy.get(id) ?? 0
      return {
        _id: id,
        companyName: c.companyName,
        outstanding: billed - received + (c.openingBalance || 0),
      }
    })
    const banks: BankLite[] = banksRaw.map((b) => ({
      _id: String(b._id),
      accountName: (b as { accountName?: string }).accountName ?? '',
    }))

    // Previously-confirmed spellings win outright over fuzzy scoring. These are
    // the same aliases the quick sale-bill screen learns, so corrections carry over.
    const aliasExactCompany = new Map<string, string>()
    const aliasExactBank = new Map<string, string>()
    const companyAliasById = new Map<string, string[]>()
    const bankAliasById = new Map<string, string[]>()
    for (const a of aliases) {
      if (a.targetType === 'company' && a.company) {
        aliasExactCompany.set(a.aliasNormalized, String(a.company))
        const k = String(a.company)
        companyAliasById.set(k, [...(companyAliasById.get(k) ?? []), a.aliasRaw])
      } else if (a.targetType === 'bank' && a.bankAccount) {
        aliasExactBank.set(a.aliasNormalized, String(a.bankAccount))
        const k = String(a.bankAccount)
        bankAliasById.set(k, [...(bankAliasById.get(k) ?? []), a.aliasRaw])
      }
    }

    const companyById = new Map(companies.map((c) => [c._id, c]))
    const bankById = new Map(banks.map((b) => [b._id, b]))
    const today = new Date().toISOString().slice(0, 10)

    const receipts: DraftReceipt[] = parsed.receipts.map((r, index) => {
      const warnings: string[] = []

      // ── Company ───────────────────────────────────────────────────────────
      let companyId: string | null = null
      let companyName: string | null = null
      let companyOutstanding: number | null = null
      let companyConfidence: MatchConfidence | null = null

      const aliasHit = aliasExactCompany.get(normalize(r.companyRaw))
      const aliasCompany = aliasHit ? companyById.get(aliasHit) : undefined
      if (aliasCompany) {
        companyId = aliasCompany._id
        companyName = aliasCompany.companyName
        companyOutstanding = aliasCompany.outstanding
        companyConfidence = 'exact'
      } else {
        const res = matchOne(r.companyRaw, companies, (c) => [
          c.companyName,
          ...(companyAliasById.get(c._id) ?? []),
        ])
        if (res.best) {
          companyId = res.best.item._id
          companyName = res.best.item.companyName
          companyOutstanding = res.best.item.outstanding
          companyConfidence = res.best.confidence
        }
        if (res.ambiguous && res.best) {
          const tied = [res.best.item.companyName, res.alternatives[0]?.item.companyName]
            .filter(Boolean)
            .join('" or "')
          warnings.push(`"${r.companyRaw}" could be "${tied}" — pick the right one`)
        }
      }

      if (!companyId) {
        warnings.push(`"${r.companyRaw}" is not in your companies — add it or pick one`)
      } else if (companyConfidence === 'low' || companyConfidence === 'medium') {
        if (!warnings.some((w) => w.includes('could be'))) {
          warnings.push(`Matched loosely to "${companyName}" — please confirm`)
        }
      }

      // ── Bank account (online mode only) ───────────────────────────────────
      let bankAccountId: string | null = null
      let bankAccountName: string | null = null
      let bankConfidence: MatchConfidence | null = null

      if (r.mode === 'online') {
        if (r.bankAccountRaw) {
          const bankAliasHit = aliasExactBank.get(normalize(r.bankAccountRaw))
          const aliasBank = bankAliasHit ? bankById.get(bankAliasHit) : undefined
          if (aliasBank) {
            bankAccountId = aliasBank._id
            bankAccountName = aliasBank.accountName
            bankConfidence = 'exact'
          } else {
            const res = matchOne(r.bankAccountRaw, banks, (bank) => [
              bank.accountName,
              ...(bankAliasById.get(bank._id) ?? []),
            ])
            if (res.best) {
              bankAccountId = res.best.item._id
              bankAccountName = res.best.item.accountName
              bankConfidence = res.best.confidence
            }
          }
          if (!bankAccountId) {
            warnings.push(`"${r.bankAccountRaw}" is not one of your online bank accounts — pick one`)
          } else if (bankConfidence === 'low' || bankConfidence === 'medium') {
            warnings.push(`Bank matched loosely to "${bankAccountName}" — please confirm`)
          }
        } else {
          warnings.push('Online payment, but no bank account named — pick one')
        }
      }

      if (r.amount < 0) {
        warnings.push(`Negative amount — this records money paid OUT to ${companyName ?? 'the company'}`)
      }

      return {
        key: `receipt-${index}`,
        sourceLine: r.sourceLine,
        paymentDate: r.paymentDate ?? today,
        companyRaw: r.companyRaw,
        companyId,
        companyName,
        companyOutstanding,
        companyConfidence,
        amount: r.amount,
        paymentMode: r.mode,
        bankAccountRaw: r.bankAccountRaw,
        bankAccountId,
        bankAccountName,
        bankConfidence,
        remark: r.notes.join(' '),
        warnings,
      }
    })

    return NextResponse.json({ success: true, data: { receipts, unparsed: parsed.unparsed } })
  } catch (error) {
    console.error('Received voucher parse API Error:', error)
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
