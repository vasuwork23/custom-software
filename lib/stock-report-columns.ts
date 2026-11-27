/**
 * Column layout of the Stock report, shared by the on-screen table and the
 * PDF / Excel exports so all three always show the same columns in the same order.
 */

export type StockReportRow = {
  productName: string
  /** All CTN ever bought for the product. */
  totalCtnBought: number
  /** CTN still in the China warehouse plus CTN on the way. */
  chinaTransitCtn: number
  /** CTN that reached India (in stock + sold). */
  indiaReceivedCtn: number
  /** CTN in stock in India right now. */
  availableCtn: number
  /** CTN sold, all time. */
  soldCtn: number
  /** soldCtn / indiaReceivedCtn × 100, null when nothing was received. */
  soldPct: number | null
  /** Weighted average purchase cost per piece. */
  avgCost: number | null
  /** Weighted average selling rate per piece. */
  avgSell: number | null
  /** (avgSell − avgCost) / avgCost × 100. */
  profitPct: number | null
}

export type StockColumnKey = keyof StockReportRow

export const STOCK_COLUMNS: { key: StockColumnKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'productName', label: 'Item', align: 'left' },
  { key: 'totalCtnBought', label: 'Total CTN', align: 'right' },
  { key: 'chinaTransitCtn', label: 'China/Transit', align: 'right' },
  { key: 'indiaReceivedCtn', label: 'India Rcvd', align: 'right' },
  { key: 'availableCtn', label: 'In Stock', align: 'right' },
  { key: 'soldCtn', label: 'Sold', align: 'right' },
  { key: 'soldPct', label: 'Sold %', align: 'right' },
  { key: 'avgCost', label: 'Avg Cost', align: 'right' },
  { key: 'avgSell', label: 'Avg Sell', align: 'right' },
  { key: 'profitPct', label: 'Profit %', align: 'right' },
]

export const ALL_STOCK_COLUMN_KEYS = STOCK_COLUMNS.map((c) => c.key)

/** Parse a comma list from the query string; unknown keys are dropped, empty means all. */
export function parseStockColumns(raw: string | null | undefined): StockColumnKey[] {
  if (!raw) return ALL_STOCK_COLUMN_KEYS
  const wanted = new Set(raw.split(',').map((s) => s.trim()))
  const picked = ALL_STOCK_COLUMN_KEYS.filter((k) => wanted.has(k))
  return picked.length ? picked : ALL_STOCK_COLUMN_KEYS
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Footer values: sums for CTN columns, overall % sold, blanks for per-piece averages. */
export function stockTotals(rows: StockReportRow[]): Partial<Record<StockColumnKey, number | string | null>> {
  const sum = (k: 'totalCtnBought' | 'chinaTransitCtn' | 'indiaReceivedCtn' | 'availableCtn' | 'soldCtn') =>
    round2(rows.reduce((s, r) => s + (r[k] ?? 0), 0))
  const received = sum('indiaReceivedCtn')
  const sold = sum('soldCtn')
  return {
    productName: 'Total',
    totalCtnBought: sum('totalCtnBought'),
    chinaTransitCtn: sum('chinaTransitCtn'),
    indiaReceivedCtn: received,
    availableCtn: sum('availableCtn'),
    soldCtn: sold,
    soldPct: received > 0 ? round2((sold / received) * 100) : null,
    avgCost: null,
    avgSell: null,
    profitPct: null,
  }
}

/** Text for one cell. `currency` is '₹' on screen; the PDF font has no ₹ glyph, so it uses 'Rs '. */
export function formatStockCell(key: StockColumnKey, value: unknown, currency = '₹'): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'string') return value
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  switch (key) {
    case 'soldPct':
    case 'profitPct':
      return `${n.toFixed(2)}%`
    case 'avgCost':
    case 'avgSell':
      return `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    default:
      return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  }
}

/** Plain values for an Excel sheet, keyed by column label, in the chosen order. */
export function stockRowsForSheet(rows: StockReportRow[], columns: StockColumnKey[]) {
  const cols = STOCK_COLUMNS.filter((c) => columns.includes(c.key))
  const toRecord = (r: Partial<Record<StockColumnKey, unknown>>) =>
    Object.fromEntries(cols.map((c) => [c.label, r[c.key] ?? '']))
  return rows.length ? [...rows.map(toRecord), toRecord(stockTotals(rows))] : []
}
