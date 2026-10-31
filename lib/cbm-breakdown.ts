/**
 * Mixed carton sizes measured for the CTN that reached India (available + sold).
 * Their average becomes the entry's `cbm` per CTN, used for every CTN.
 *
 * Each row can also carry its own carrying rate and RMB rate (optional, but
 * all-or-none per column). When a column is filled for every row, its weighted
 * average becomes the entry's carryingRate / avgRmbRate.
 */
export interface CbmBreakdownRow {
  ctn: number
  cbm: number // CBM per CTN for this group
  carryingRate?: number // INR per CBM for this group
  rmbRate?: number // RMB→INR rate for this group
}

export interface CbmBreakdownSummary {
  totalCtn: number
  totalCbm: number
  /** Weighted average CBM per CTN of the measured cartons, unrounded */
  avgCbm: number
  /** CBM-weighted carrying rate, or null when the column is not filled for every row */
  avgCarryingRate: number | null
  /** CTN-weighted RMB rate, or null when the column is not filled for every row */
  avgRmbRate: number | null
  /** Every row has ctn > 0 and cbm > 0, and each rate column is filled for all rows or none */
  valid: boolean
}

const filled = (v: unknown) => v != null && (v as unknown) !== '' && Number.isFinite(Number(v))

export function summarizeCbmBreakdown(rows: CbmBreakdownRow[]): CbmBreakdownSummary {
  let totalCtn = 0
  let totalCbm = 0
  let carryingAmount = 0 // Σ ctn × cbm × carryingRate
  let rmbWeighted = 0 // Σ ctn × rmbRate
  let carryingCount = 0
  let rmbCount = 0
  let valid = rows.length > 0
  for (const r of rows) {
    const ctn = Number(r.ctn)
    const cbm = Number(r.cbm)
    if (!Number.isFinite(ctn) || !Number.isFinite(cbm) || ctn <= 0 || cbm <= 0) valid = false
    const safeCtn = Number.isFinite(ctn) ? ctn : 0
    const groupCbm = Number.isFinite(ctn) && Number.isFinite(cbm) ? ctn * cbm : 0
    totalCtn += safeCtn
    totalCbm += groupCbm
    if (filled(r.carryingRate)) {
      if (Number(r.carryingRate) <= 0) valid = false
      carryingCount++
      carryingAmount += groupCbm * Number(r.carryingRate)
    }
    if (filled(r.rmbRate)) {
      if (Number(r.rmbRate) <= 0) valid = false
      rmbCount++
      rmbWeighted += safeCtn * Number(r.rmbRate)
    }
  }
  // A rate column is all-or-none
  if (carryingCount > 0 && carryingCount < rows.length) valid = false
  if (rmbCount > 0 && rmbCount < rows.length) valid = false
  return {
    totalCtn,
    totalCbm,
    avgCbm: totalCtn > 0 ? totalCbm / totalCtn : 0,
    avgCarryingRate: carryingCount === rows.length && totalCbm > 0 ? carryingAmount / totalCbm : null,
    avgRmbRate: rmbCount === rows.length && totalCtn > 0 ? rmbWeighted / totalCtn : null,
    valid,
  }
}

const r5 = (n: number) => parseFloat(n.toFixed(5))

/** CBM per CTN for the whole entry: the average of the measured sizes, 5 decimals. */
export function avgCbmPerCtn(rows: CbmBreakdownRow[]): number {
  return r5(summarizeCbmBreakdown(rows).avgCbm)
}

/** Entry-level averages from the rows (5 decimals); a rate is null when its column is empty. */
export function breakdownAverages(rows: CbmBreakdownRow[]): {
  cbm: number
  carryingRate: number | null
  avgRmbRate: number | null
} {
  const s = summarizeCbmBreakdown(rows)
  return {
    cbm: r5(s.avgCbm),
    carryingRate: s.avgCarryingRate == null ? null : r5(s.avgCarryingRate),
    avgRmbRate: s.avgRmbRate == null ? null : r5(s.avgRmbRate),
  }
}

/** CTN that reached India (available + sold) = total − China WH − in transit. */
export function indiaCtn(totalCtn: number, chinaWarehouseCtn: number, inTransitCtn: number): number {
  return parseFloat(Math.max(0, totalCtn - chinaWarehouseCtn - inTransitCtn).toFixed(4))
}

/** Error message when the rows are incomplete or don't add up to the India CTN, or null when fine. */
export function cbmBreakdownError(rows: CbmBreakdownRow[], expectedCtn: number): string | null {
  for (const r of rows) {
    const ctn = Number(r.ctn)
    const cbm = Number(r.cbm)
    if (!Number.isFinite(ctn) || !Number.isFinite(cbm) || ctn <= 0 || cbm <= 0) {
      return 'Enter CTN and CBM (greater than 0) for every carton size'
    }
    if ((filled(r.carryingRate) && Number(r.carryingRate) <= 0) || (filled(r.rmbRate) && Number(r.rmbRate) <= 0)) {
      return 'Rates must be greater than 0'
    }
  }
  const carryingCount = rows.filter((r) => filled(r.carryingRate)).length
  if (carryingCount > 0 && carryingCount < rows.length) {
    return 'Fill Carrying Rate for every row, or leave it empty in all rows'
  }
  const rmbCount = rows.filter((r) => filled(r.rmbRate)).length
  if (rmbCount > 0 && rmbCount < rows.length) {
    return 'Fill Avg RMB Rate for every row, or leave it empty in all rows'
  }
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

const optionalRate = (v: unknown): number | undefined => (filled(v) ? Number(v) : undefined)

/** Parse an untrusted request body value. undefined = not sent, null = clear, string = error. */
export function parseCbmBreakdown(
  raw: unknown,
  expectedIndiaCtn: number
): CbmBreakdownRow[] | null | undefined | string {
  if (raw === undefined) return undefined
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return null
  if (!Array.isArray(raw)) return 'cbmBreakdown must be a list'
  const rows: CbmBreakdownRow[] = raw.map((r) => {
    const o = (r ?? {}) as { ctn?: unknown; cbm?: unknown; carryingRate?: unknown; rmbRate?: unknown }
    const row: CbmBreakdownRow = { ctn: Number(o.ctn), cbm: Number(o.cbm) }
    const carrying = optionalRate(o.carryingRate)
    const rmb = optionalRate(o.rmbRate)
    if (carrying !== undefined) row.carryingRate = carrying
    if (rmb !== undefined) row.rmbRate = rmb
    return row
  })
  return cbmBreakdownError(rows, expectedIndiaCtn) ?? rows
}
