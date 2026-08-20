/**
 * Deterministic parser for pasted WhatsApp / hand-typed sale messages.
 *
 * Extracts by PATTERN, not by position, so "3 ctn - tester @12.5" and
 * "Strip k (m-1) - 1000 piece" both parse correctly despite reversed order.
 * No external services, no API keys — pure string processing.
 */

import { normalize } from '@/lib/fuzzy-match'

export type Unit = 'ctn' | 'pcs'

/** How the bill gets settled, when the message says so explicitly. */
export type PaymentMode = 'company' | 'cashbook' | 'bank'

export interface ParsedItem {
  productRaw: string
  qty: number
  unit: Unit
  rate: number | null
  sourceLine: string
}

export interface ParsedBill {
  paymentMode: PaymentMode
  /** Bank account name when paymentMode is 'bank' (the line after "bankbook"). */
  bankAccountRaw: string | null
  /** True when the message named no company and no mode, so cashbook was assumed. */
  assumedCashbook: boolean
  companyRaw: string | null
  billDate: string | null // yyyy-MM-dd
  items: ParsedItem[]
  notes: string[]
  sourceText: string
}

export interface ParseResult {
  bills: ParsedBill[]
  unparsed: string[]
}

// ─── Unit vocabulary ──────────────────────────────────────────────────────────

const CTN_WORDS = ['ctn', 'ctns', 'cartoon', 'cartoons', 'carton', 'cartons', 'cart', 'case', 'cases', 'box', 'boxes', 'bx']
const PCS_WORDS = ['pcs', 'pc', 'pec', 'pes', 'piece', 'pieces', 'peice', 'peices', 'pis', 'nos', 'no', 'unit', 'units']

const UNIT_LOOKUP = new Map<string, Unit>()
for (const w of CTN_WORDS) UNIT_LOOKUP.set(w, 'ctn')
for (const w of PCS_WORDS) UNIT_LOOKUP.set(w, 'pcs')

const ALL_UNIT_WORDS = [...CTN_WORDS, ...PCS_WORDS].sort((a, b) => b.length - a.length)

// number + unit, e.g. "3 ctn", "1000 piece", "2.5ctn"
const QTY_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${ALL_UNIT_WORDS.join('|')})\\b`, 'i')

// "@12.5", "@ Rs 250", "@₹128/-"
const RATE_RE = /@\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(?:\/-|\/)?/i
// fallback: "rate 12.5", "price - 250"
const RATE_WORD_RE = /\b(?:rate|price|rs\.?|₹)\s*[:\-]?\s*(\d+(?:\.\d+)?)\b/i

// ─── WhatsApp export headers ──────────────────────────────────────────────────
// Handles both:   [20/08/26, 11:51:36 AM] Sender: text
//   and:          20/08/26, 11:51 AM - Sender: text
const WA_HEADER_RE =
  /^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\]?\s*(?:-\s*)?([^:\n]{1,60}?):\s*/

/** Media/system lines a WhatsApp export sprinkles in. */
const NOISE_RE =
  /^(<Media omitted>|image omitted|video omitted|sticker omitted|This message was deleted|Messages and calls are end-to-end encrypted.*|null)$/i

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** dd/mm/yy (or yyyy) → yyyy-MM-dd. WhatsApp exports are day-first. */
function toIsoDate(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10)
  const month = parseInt(m, 10)
  let year = parseInt(y, 10)
  if (y.length <= 2) year += year < 70 ? 2000 : 1900
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

// ─── Payment-mode keywords ────────────────────────────────────────────────────
// Compared against the whole normalised line, never as a substring, so a real
// company such as "Cash & Carry Traders" is not mistaken for a cash sale.

const CASHBOOK_KEYWORDS = new Set([
  'cash', 'cashbook', 'cash book', 'cashbk', 'cash sale', 'cash bill', 'cashbook sale',
])

const BANK_KEYWORDS = new Set([
  'bank', 'bankbook', 'bank book', 'bankbk', 'bank sale', 'bank bill',
  'bank account', 'bank ac', 'bank a c',
])

// ─── Line-level parsing ───────────────────────────────────────────────────────

/** Strips separator noise left over after qty/rate have been removed. */
function cleanProductName(raw: string): string {
  return raw
    .replace(/[·•*]/g, ' ')
    .replace(/^[\s\-–—:,.=]+/, '')
    .replace(/[\s\-–—:,.=]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Parses one line into an item, or returns null when the line carries no
 * quantity (a line with no qty is a company name or a free-text note).
 */
export function parseItemLine(line: string): ParsedItem | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const qtyMatch = QTY_RE.exec(trimmed)
  if (!qtyMatch) return null

  const qty = parseFloat(qtyMatch[1])
  if (!Number.isFinite(qty) || qty <= 0) return null
  const unit = UNIT_LOOKUP.get(qtyMatch[2].toLowerCase()) ?? 'ctn'

  // Remove the qty token, then the rate token — whatever survives is the product.
  let remainder = trimmed.slice(0, qtyMatch.index) + ' ' + trimmed.slice(qtyMatch.index + qtyMatch[0].length)

  let rate: number | null = null
  const rateMatch = RATE_RE.exec(remainder)
  if (rateMatch) {
    rate = parseFloat(rateMatch[1])
    remainder = remainder.slice(0, rateMatch.index) + ' ' + remainder.slice(rateMatch.index + rateMatch[0].length)
  } else {
    const rw = RATE_WORD_RE.exec(remainder)
    if (rw) {
      rate = parseFloat(rw[1])
      remainder = remainder.slice(0, rw.index) + ' ' + remainder.slice(rw.index + rw[0].length)
    }
  }
  if (rate != null && (!Number.isFinite(rate) || rate < 0)) rate = null

  const productRaw = cleanProductName(remainder)
  if (!productRaw) return null

  return { productRaw, qty, unit, rate, sourceLine: trimmed }
}

// ─── Block-level parsing ──────────────────────────────────────────────────────

interface RawBlock {
  date: string | null
  lines: string[]
}

/**
 * Splits the paste into blocks. A WhatsApp timestamp header always starts a new
 * block. A blank line also ends a block, but only once that block already holds
 * an item line — before that the blank is just spacing between a company name
 * and its items, which real exports do contain.
 */
function splitBlocks(text: string): RawBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: RawBlock[] = []
  let current: RawBlock | null = null
  let currentHasItem = false

  const flush = () => {
    if (current && current.lines.length) blocks.push(current)
    current = null
    currentHasItem = false
  }

  const push = (line: string) => {
    if (!current) current = { date: null, lines: [] }
    current.lines.push(line)
    if (!currentHasItem && parseItemLine(line)) currentHasItem = true
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u200e|\u200f/g, '').trimEnd()
    const header = WA_HEADER_RE.exec(line)

    if (header) {
      flush()
      current = { date: toIsoDate(header[1], header[2], header[3]), lines: [] }
      const rest = line.slice(header[0].length).trim()
      if (rest) push(rest)
      continue
    }

    if (!line.trim()) {
      if (currentHasItem) flush()
      continue
    }

    push(line.trim())
  }
  flush()

  return blocks
}

/** Parses pasted chat text into draft bills. Never throws on bad input. */
export function parseMessages(text: string): ParseResult {
  const unparsed: string[] = []
  const bills: ParsedBill[] = []

  for (const block of splitBlocks(text)) {
    const lines = block.lines.filter((l) => !NOISE_RE.test(l.trim()))
    if (!lines.length) continue

    const items: ParsedItem[] = []
    const notes: string[] = []
    // Lines with no quantity that appear before the first item: these carry the
    // company name, or a payment-mode keyword plus its bank account name.
    const headerLines: string[] = []

    for (const line of lines) {
      const item = parseItemLine(line)
      if (item) {
        items.push(item)
        continue
      }
      if (items.length === 0) headerLines.push(line)
      else notes.push(line)
    }

    let paymentMode: PaymentMode = 'company'
    let companyRaw: string | null = null
    let bankAccountRaw: string | null = null
    let assumedCashbook = false

    if (!headerLines.length) {
      // Just item lines — no company, no keyword. Treat it as a cash sale.
      paymentMode = 'cashbook'
      assumedCashbook = true
    } else {
      const firstNormalized = normalize(headerLines[0])
      if (CASHBOOK_KEYWORDS.has(firstNormalized)) {
        paymentMode = 'cashbook'
        notes.unshift(...headerLines.slice(1))
      } else if (BANK_KEYWORDS.has(firstNormalized)) {
        paymentMode = 'bank'
        // The line straight after the keyword names the bank account.
        bankAccountRaw = headerLines[1] ? cleanProductName(headerLines[1]) : null
        notes.unshift(...headerLines.slice(2))
      } else {
        companyRaw = cleanProductName(headerLines[0])
        notes.unshift(...headerLines.slice(1))
      }
    }

    if (!items.length) {
      // A block with no items at all is not a bill — surface it for review.
      unparsed.push(lines.join('\n'))
      continue
    }

    bills.push({
      paymentMode,
      bankAccountRaw,
      assumedCashbook,
      companyRaw,
      billDate: block.date,
      items,
      notes,
      sourceText: lines.join('\n'),
    })
  }

  return { bills, unparsed }
}
