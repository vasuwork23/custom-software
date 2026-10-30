/**
 * Mixed carton sizes measured for the CTN that reached India (available + sold).
 * Their average becomes the entry's `cbm` per CTN, used for every CTN.
 */
export interface CbmBreakdownRow {
  ctn: number
  cbm: number // CBM per CTN for this group
}

export interface CbmBreakdownSummary {
  totalCtn: number
  totalCbm: number
  /** Weighted average CBM per CTN of the measured cartons, unrounded */
  avgCbm: number
  /** Every row has ctn > 0 and cbm > 0 */
  valid: boolean
}

export function summarizeCbmBreakdown(rows: CbmBreakdownRow[]): CbmBreakdownSummary {
  let totalCtn = 0
  let totalCbm = 0
  let valid = rows.length > 0
  for (const r of rows) {
    const ctn = Number(r.ctn)
    const cbm = Number(r.cbm)
    if (!Number.isFinite(ctn) || !Number.isFinite(cbm) || ctn <= 0 || cbm <= 0) valid = false
    totalCtn += Number.isFinite(ctn) ? ctn : 0
    totalCbm += Number.isFinite(ctn) && Number.isFinite(cbm) ? ctn * cbm : 0
  }
  return { totalCtn, totalCbm, avgCbm: totalCtn > 0 ? totalCbm / totalCtn : 0, valid }
}

/** CBM per CTN for the whole entry: the average of the measured sizes, 5 decimals. */
export function avgCbmPerCtn(rows: CbmBreakdownRow[]): number {
  return parseFloat(summarizeCbmBreakdown(rows).avgCbm.toFixed(5))
}

/** CTN that reached India (available + sold) = total − China WH − in transit. */
export function indiaCtn(totalCtn: number, chinaWarehouseCtn: number, inTransitCtn: number): number {
  return parseFloat(Math.max(0, totalCtn - chinaWarehouseCtn - inTransitCtn).toFixed(4))
}

/** Error message when the sizes don't add up to the India CTN, or null when they do. */
export function cbmBreakdownError(rows: CbmBreakdownRow[], expectedCtn: number): string | null {
  const summary = summarizeCbmBreakdown(rows)
  if (!summary.valid) return 'Enter CTN and CBM (greater than 0) for every carton size'
  const left = parseFloat((expectedCtn - summary.totalCtn).toFixed(4))
  if (Math.abs(left) > 1e-6) {
    return left > 0
      ? `${left} CTN in India not assigned to a carton size yet`
      : `${-left} CTN more than the ${expectedCtn} CTN in India`
  }
  return null
}

/** Parse an untrusted request body value. undefined = not sent, null = clear, string = error. */
export function parseCbmBreakdown(
  raw: unknown,
  expectedIndiaCtn: number
): CbmBreakdownRow[] | null | undefined | string {
  if (raw === undefined) return undefined
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return null
  if (!Array.isArray(raw)) return 'cbmBreakdown must be a list'
  const rows: CbmBreakdownRow[] = raw.map((r) => ({
    ctn: Number((r as { ctn?: unknown })?.ctn),
    cbm: Number((r as { cbm?: unknown })?.cbm),
  }))
  return cbmBreakdownError(rows, expectedIndiaCtn) ?? rows
}
