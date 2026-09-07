/**
 * Get start and end dates for report period.
 * period: 'week' | 'month' | 'year' — relative to today.
 * startDate/endDate: optional ISO date strings for custom range (override period).
 */
export function getReportDateRange(
  period: string,
  startDate?: string | null,
  endDate?: string | null
): { start: Date; end: Date } {
  const now = new Date()
  if (startDate && endDate) {
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999)
      return { start, end }
    }
  }
  let start: Date
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      break
    case 'week': {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0)
      break
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
      break
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  }
  return { start, end }
}

/** MongoDB $dateToString format for grouping by period */
export function getPeriodFormat(period: string): string {
  switch (period) {
    case 'today':
      return '%Y-%m-%d'
    case 'week':
      return '%Y-W%V'
    case 'month':
      return '%Y-%m'
    case 'year':
      return '%Y'
    case 'custom':
      return '%Y-%m-%d'
    default:
      return '%Y-%m-%d'
  }
}

export type Granularity = 'day' | 'week' | 'month'

const DAY_MS = 86_400_000

/**
 * The calendar day a report boundary refers to, pinned to UTC.
 *
 * getReportDateRange builds *local* midnights, while bill and expense dates are
 * stored as UTC midnight and $dateToString buckets in UTC. Reading the local
 * calendar parts and re-pinning them to UTC keeps bucket keys aligned with the
 * dates the user actually picked, whatever timezone the server runs in.
 */
function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

/** Monday of the week containing `d` — matches the week that getReportDateRange starts. */
function weekStart(d: Date): Date {
  const day = d.getUTCDay()
  return new Date(d.getTime() + (day === 0 ? -6 : 1 - day) * DAY_MS)
}

function spanDays(start: Date, end: Date): number {
  return Math.round((toUtcDay(end).getTime() - toUtcDay(start).getTime()) / DAY_MS) + 1
}

/**
 * Bucket size one step finer than the selected period, so a month breaks into its
 * days rather than collapsing into a single bar.
 */
export function getDefaultGranularity(period: string, start: Date, end: Date): Granularity {
  switch (period) {
    case 'today':
    case 'week':
    case 'month':
      return 'day'
    case 'year':
      return 'month'
    default: {
      const days = spanDays(start, end)
      if (days <= 31) return 'day'
      if (days <= 183) return 'week'
      return 'month'
    }
  }
}

/**
 * The granularity to actually chart: the caller's choice when it is one we support,
 * otherwise the default for the period — coarsened either way so a long range can
 * never produce hundreds of unreadable bars.
 */
export function resolveGranularity(
  requested: string | null | undefined,
  period: string,
  start: Date,
  end: Date
): Granularity {
  const days = spanDays(start, end)
  let granularity: Granularity =
    requested === 'day' || requested === 'week' || requested === 'month'
      ? requested
      : getDefaultGranularity(period, start, end)
  if (granularity === 'day' && days > 92) granularity = 'week'
  if (granularity === 'week' && days > 92 * 7) granularity = 'month'
  return granularity
}

export interface TrendBucket {
  /** Bucket key: 'YYYY-MM-DD' for day and week buckets, 'YYYY-MM' for month. */
  period: string
  /** First and last day the bucket covers, clamped to the report range. */
  start: string
  end: string
  revenue: number
  cost: number
  grossProfit: number
  netProfit: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Expand day-keyed aggregation results into a gap-free series at `granularity`.
 *
 * Aggregations only return days that had activity, so charting them raw draws a
 * month with nine selling days as nine bars and reads as a nine-day month. Walking
 * the whole range instead gives quiet days an explicit zero.
 */
export function buildTrendSeries(params: {
  start: Date
  end: Date
  granularity: Granularity
  sales: Map<string, { revenue: number; cost: number; grossProfit: number }>
  expenses: Map<string, number>
}): TrendBucket[] {
  const { granularity, sales, expenses } = params
  let first = toUtcDay(params.start)
  let last = toUtcDay(params.end)
  if (last.getTime() < first.getTime()) return []

  // The range filter compares local-midnight boundaries against UTC-midnight dates, so
  // on a server running behind UTC a matched row can key to a day just outside the walked
  // window. Widen by up to two days rather than dropping it: the summary cards count that
  // row, and a chart that does not add up to the summary is worse than one extra bar.
  // A UTC offset can shift the boundary by at most one calendar day, so widen by no
  // more than that — anything further out is not timezone skew and stays excluded.
  const earliest = first.getTime() - DAY_MS
  const latest = last.getTime() + DAY_MS
  const widen = (key: string) => {
    const t = Date.parse(`${key}T00:00:00.000Z`)
    if (Number.isNaN(t)) return
    if (t < first.getTime() && t >= earliest) first = new Date(t)
    else if (t > last.getTime() && t <= latest) last = new Date(t)
  }
  sales.forEach((_, key) => widen(key))
  expenses.forEach((_, key) => widen(key))

  const buckets: TrendBucket[] = []
  const byKey = new Map<string, TrendBucket>()
  const expenseByBucket = new Map<string, number>()

  for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) {
    const day = new Date(t)
    const key = dayKey(day)

    let bucketStart: Date
    let bucketEnd: Date
    if (granularity === 'day') {
      bucketStart = day
      bucketEnd = day
    } else if (granularity === 'week') {
      bucketStart = weekStart(day)
      bucketEnd = new Date(bucketStart.getTime() + 6 * DAY_MS)
    } else {
      bucketStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
      bucketEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0))
    }
    // An edge bucket only covers the part of itself inside the report range.
    if (bucketStart.getTime() < first.getTime()) bucketStart = first
    if (bucketEnd.getTime() > last.getTime()) bucketEnd = last

    const bucketKey = granularity === 'month' ? key.slice(0, 7) : dayKey(bucketStart)
    let bucket = byKey.get(bucketKey)
    if (!bucket) {
      bucket = {
        period: bucketKey,
        start: dayKey(bucketStart),
        end: dayKey(bucketEnd),
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        netProfit: 0,
      }
      byKey.set(bucketKey, bucket)
      buckets.push(bucket)
    } else if (dayKey(bucketEnd) > bucket.end) {
      bucket.end = dayKey(bucketEnd)
    }

    const sale = sales.get(key)
    if (sale) {
      bucket.revenue += sale.revenue
      bucket.cost += sale.cost
      bucket.grossProfit += sale.grossProfit
    }
    const expense = expenses.get(key)
    if (expense) expenseByBucket.set(bucketKey, (expenseByBucket.get(bucketKey) ?? 0) + expense)
  }

  for (const bucket of buckets) {
    bucket.revenue = round2(bucket.revenue)
    bucket.cost = round2(bucket.cost)
    bucket.grossProfit = round2(bucket.grossProfit)
    bucket.netProfit = round2(bucket.grossProfit - (expenseByBucket.get(bucket.period) ?? 0))
  }

  return buckets
}
