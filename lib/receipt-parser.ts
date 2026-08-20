/**
 * Deterministic parser for pasted payment-receipt messages.
 *
 * One entry per line: `COMPANY NAME@AMOUNT`, with any following plain lines
 * treated as notes for that entry. Payment mode is set by a `cash` or
 * `bankbook` header line and stays in effect until the next header.
 * No external services, no API keys — pure string processing.
 */

import { normalize } from '@/lib/fuzzy-match'

export type ReceiptMode = 'cash' | 'online'

export interface ParsedReceipt {
  companyRaw: string
  amount: number
  mode: ReceiptMode
  /** Bank account name when mode is 'online' (the line after "bankbook"). */
  bankAccountRaw: string | null
  notes: string[]
  paymentDate: string | null // yyyy-MM-dd
  sourceLine: string
}

export interface ReceiptParseResult {
  receipts: ParsedReceipt[]
  unparsed: string[]
}

// `COMPANY@50000`, `COMPANY @ Rs 50,000`, `COMPANY@-5000`, `COMPANY@₹5000/-`
const ENTRY_RE = /^(.*?)@\s*(?:rs\.?|inr|₹)?\s*(-?[\d,]+(?:\.\d+)?)\s*(?:\/-|\/)?$/i

const CASH_KEYWORDS = new Set([
  'cash', 'cashbook', 'cash book', 'cashbk', 'rokad', 'cash payment', 'by cash',
])
const BANK_KEYWORDS = new Set([
  'bank', 'bankbook', 'bank book', 'bankbk', 'online', 'bank account',
  'bank ac', 'bank a c', 'neft', 'rtgs', 'upi', 'by bank',
])

const WA_HEADER_RE =
  /^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\]?\s*(?:-\s*)?([^:\n]{1,60}?):\s*/

const NOISE_RE =
  /^(<Media omitted>|image omitted|video omitted|sticker omitted|This message was deleted|Messages and calls are end-to-end encrypted.*|null)$/i

const pad = (n: number) => String(n).padStart(2, '0')

function toIsoDate(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10)
  const month = parseInt(m, 10)
  let year = parseInt(y, 10)
  if (y.length <= 2) year += year < 70 ? 2000 : 1900
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function cleanName(raw: string): string {
  return raw
    .replace(/[·•*]/g, ' ')
    .replace(/^[\s\-–—:,.=]+/, '')
    .replace(/[\s\-–—:,.=]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Parses one line as `company@amount`, or returns null if it isn't one. */
export function parseEntryLine(line: string): { companyRaw: string; amount: number } | null {
  const trimmed = line.trim()
  if (!trimmed.includes('@')) return null

  const m = ENTRY_RE.exec(trimmed)
  if (!m) return null

  const companyRaw = cleanName(m[1])
  if (!companyRaw) return null

  const amount = parseFloat(m[2].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount === 0) return null

  return { companyRaw, amount }
}

/** Parses pasted text into draft payment receipts. Never throws on bad input. */
export function parseReceiptMessages(text: string): ReceiptParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const receipts: ParsedReceipt[] = []
  const unparsed: string[] = []

  let mode: ReceiptMode = 'cash'
  let bankAccountRaw: string | null = null
  let expectBankName = false
  let currentDate: string | null = null

  for (const rawLine of lines) {
    let line = rawLine.replace(/‎|‏/g, '').trim()
    if (!line) continue

    // A WhatsApp header sets the date; the rest of the line is still content.
    const header = WA_HEADER_RE.exec(line)
    if (header) {
      currentDate = toIsoDate(header[1], header[2], header[3])
      line = line.slice(header[0].length).trim()
      if (!line) continue
    }

    if (NOISE_RE.test(line)) continue

    // Mode headers apply to every entry after them, until changed.
    const normalized = normalize(line)
    if (CASH_KEYWORDS.has(normalized)) {
      mode = 'cash'
      bankAccountRaw = null
      expectBankName = false
      continue
    }
    if (BANK_KEYWORDS.has(normalized)) {
      mode = 'online'
      bankAccountRaw = null
      expectBankName = true
      continue
    }

    const entry = parseEntryLine(line)

    // The line straight after a bank header names the account — unless it is
    // already an entry, in which case the account was simply not given.
    if (expectBankName && !entry) {
      bankAccountRaw = cleanName(line)
      expectBankName = false
      continue
    }
    expectBankName = false

    if (entry) {
      receipts.push({
        companyRaw: entry.companyRaw,
        amount: entry.amount,
        mode,
        bankAccountRaw: mode === 'online' ? bankAccountRaw : null,
        notes: [],
        paymentDate: currentDate,
        sourceLine: line,
      })
      continue
    }

    // Plain text after an entry is a note for it.
    if (receipts.length) receipts[receipts.length - 1].notes.push(line)
    else unparsed.push(line)
  }

  return { receipts, unparsed }
}
