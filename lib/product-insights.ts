/**
 * Product Insights: per-product health, trend and reorder maths.
 *
 * Pure functions only — the API route gathers raw rows and hands them here.
 * Every number is an estimate built from our own sales; the market (competitors)
 * is invisible to us, so the output is ranges, confidence and warning signals
 * rather than exact answers.
 */

const DAY = 86_400_000

export type InsightLabel = 'star' | 'good' | 'watch' | 'bad' | 'dead' | 'new'
export type TrendDir = 'up' | 'flat' | 'down' | 'none'
export type ReorderStatus = 'now' | 'soon' | 'ok' | 'overstock' | 'no-demand'
export type MeasureSource = 'entries' | 'manual' | null

export interface SaleRow {
  productId: string
  billDate: Date
  customerKey: string // 'cashbook' for walk-in sales
  ctnSold: number
  pcsSold: number
  revenue: number // discount-adjusted
  profit: number // discount-adjusted
}

export interface EntryRow {
  productId: string
  entryDate: Date
  totalCtn: number
  qtyPerCtn: number
  cbmPerCtn: number
  weightPerCtn: number
  finalCost: number // INR per piece (landed)
  availableCtn: number // in India, ready to sell
  pipelineCtn: number // factory + China WH + in transit (China only)
}

export interface ProductRow {
  id: string
  name: string
  ctnWeightKg?: number | null
  ctnCbm?: number | null
}

export type OverrideTag = 'none' | 'discontinue' | 'hold' | 'competitor' | 'seasonal' | 'push'

/** Your own call on a product; it outranks what the sales data says. */
export interface InsightOverride {
  tag: OverrideTag
  demandAdjustPct: number // applied to daily demand for reordering, e.g. +30 for a coming season
  note?: string
  updatedAt?: string
  updatedByName?: string
}

export interface LostCustomer {
  name: string
  bills: number
  ctn: number
  lastSaleDaysAgo: number
}

export interface InsightOptions {
  now: Date
  leadTimeDays: number
  coverDays: number
  customerNames?: Map<string, string>
  overrides?: Map<string, InsightOverride>
}

export interface ProductInsight {
  id: string
  name: string
  label: InsightLabel
  score: number | null
  abc: 'A' | 'B' | 'C'
  xyz: 'X' | 'Y' | 'Z' | null
  // demand
  sold30: number
  soldPrev30: number
  sold90: number
  sold180: number
  weekly: number[] // CTN per week, oldest first (12 weeks)
  dailyDemand: number
  trendPct: number | null
  trend: TrendDir
  bills90: number
  daysSinceLastSale: number | null
  customers180: number
  topCustomerShare: number | null // among named customers, 0..1
  lostCustomers: LostCustomer[]
  // money
  revenue90: number
  profit90: number
  profit180: number
  profitPerCtn: number | null
  stockReturn: number | null // yearly profit ÷ money in stock (at cost)
  marginPct: number | null
  marginDeltaPp: number | null
  priceChangePct: number | null
  costChangePct: number | null
  // physical
  qtyPerCtn: number | null
  cbmPerCtn: number | null
  cbmSource: MeasureSource
  weightPerCtn: number | null
  weightSource: MeasureSource
  kgPerCbm: number | null
  profitPerCbm: number | null
  // stock
  availableCtn: number
  pipelineCtn: number
  stockValue: number
  oldestStockDays: number | null
  daysOfCover: number | null
  reorderPoint: number
  suggestMin: number
  suggestMax: number
  reorderStatus: ReorderStatus
  confidence: 'high' | 'medium' | 'low'
  // explanation
  scoreParts: { key: string; label: string; weight: number; value: number | null }[]
  signals: { tone: 'good' | 'warn' | 'bad' | 'info'; text: string }[]
  competitorPressure: boolean
  priceCutNoLift: boolean
  override: InsightOverride | null
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

/** Weighted average of `value` over rows where value > 0, weighted by `weight`. */
function weightedAvg<T>(rows: T[], value: (r: T) => number, weight: (r: T) => number): number | null {
  let sw = 0
  let sv = 0
  for (const r of rows) {
    const v = value(r)
    const w = weight(r)
    if (v > 0 && w > 0) {
      sw += w
      sv += v * w
    }
  }
  return sw > 0 ? sv / sw : null
}

/** Rank of each value within the list, 0..100 (ties share the lower rank). */
function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null).sort((a, b) => a - b)
  if (present.length === 0) return values.map(() => null)
  if (present.length === 1) return values.map((v) => (v == null ? null : 50))
  return values.map((v) => {
    if (v == null) return null
    const below = present.findIndex((p) => p >= v)
    return (below / (present.length - 1)) * 100
  })
}

export function computeInsights(
  products: ProductRow[],
  entries: EntryRow[],
  sales: SaleRow[],
  opts: InsightOptions
): ProductInsight[] {
  const now = opts.now.getTime()
  const daysAgo = (d: Date) => Math.max(0, Math.floor((now - d.getTime()) / DAY))

  const entriesBy = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const list = entriesBy.get(e.productId) ?? []
    list.push(e)
    entriesBy.set(e.productId, list)
  }
  const salesBy = new Map<string, SaleRow[]>()
  for (const s of sales) {
    const list = salesBy.get(s.productId) ?? []
    list.push(s)
    salesBy.set(s.productId, list)
  }

  const base = products.map((p) => {
    const es = entriesBy.get(p.id) ?? []
    const ss = salesBy.get(p.id) ?? []

    // ── Demand windows ───────────────────────────────────────────────────
    let sold30 = 0, soldPrev30 = 0, sold90 = 0, sold180 = 0
    let revenue90 = 0, profit90 = 0, profitPrev90 = 0, revenuePrev90 = 0, profit180 = 0, revenue180 = 0
    let pcs30 = 0, rev30 = 0, pcsPrice = 0, revPrice = 0
    const weekly = new Array(12).fill(0) as number[]
    const bills90 = new Set<string>()
    const customerCtn = new Map<string, number>()
    const customerLast = new Map<string, number>()
    const customerBills = new Map<string, Set<number>>()
    let firstSaleAgo = -1
    let lastSaleAgo: number | null = null

    for (const s of ss) {
      const ago = daysAgo(s.billDate)
      firstSaleAgo = Math.max(firstSaleAgo, ago)
      lastSaleAgo = lastSaleAgo == null ? ago : Math.min(lastSaleAgo, ago)
      if (ago < 30) {
        sold30 += s.ctnSold
        pcs30 += s.pcsSold
        rev30 += s.revenue
      } else if (ago < 60) soldPrev30 += s.ctnSold
      // Price baseline: the 90 days before the last 30
      if (ago >= 30 && ago < 120) {
        pcsPrice += s.pcsSold
        revPrice += s.revenue
      }
      if (ago < 90) {
        sold90 += s.ctnSold
        revenue90 += s.revenue
        profit90 += s.profit
        bills90.add(`${s.billDate.getTime()}:${s.customerKey}`)
      } else if (ago < 180) {
        profitPrev90 += s.profit
        revenuePrev90 += s.revenue
      }
      if (ago < 180) {
        sold180 += s.ctnSold
        profit180 += s.profit
        revenue180 += s.revenue
        customerCtn.set(s.customerKey, (customerCtn.get(s.customerKey) ?? 0) + s.ctnSold)
        customerLast.set(s.customerKey, Math.min(customerLast.get(s.customerKey) ?? Infinity, ago))
        const bills = customerBills.get(s.customerKey) ?? new Set<number>()
        bills.add(s.billDate.getTime())
        customerBills.set(s.customerKey, bills)
      }
      const week = Math.floor(ago / 7)
      if (week < 12) weekly[11 - week] += s.ctnSold
    }

    // Velocity counts only the days the product has actually been selling,
    // so a product launched 3 weeks ago isn't diluted over 90 days.
    const activeDays = (window: number) => Math.max(14, Math.min(window, firstSaleAgo + 1))
    const v30 = firstSaleAgo >= 0 ? sold30 / activeDays(30) : 0
    const v90 = firstSaleAgo >= 0 ? sold90 / activeDays(90) : 0
    let dailyDemand = 0.6 * v30 + 0.4 * v90 // recent weeks weigh more

    let trendPct: number | null = null
    let trend: TrendDir = 'none'
    if (sold30 + soldPrev30 >= 3 && firstSaleAgo >= 45) {
      trendPct = soldPrev30 > 0 ? ((sold30 - soldPrev30) / soldPrev30) * 100 : 100
      trend = trendPct > 20 ? 'up' : trendPct < -20 ? 'down' : 'flat'
    }

    // Demand variability (coefficient of variation of weekly sales)
    const activeWeeks = firstSaleAgo >= 0 ? Math.min(12, Math.floor(firstSaleAgo / 7) + 1) : 0
    let xyz: ProductInsight['xyz'] = null
    let weeklyStd = 0
    if (activeWeeks >= 4) {
      const w = weekly.slice(12 - activeWeeks)
      const mean = w.reduce((a, b) => a + b, 0) / w.length
      weeklyStd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length)
      const cv = mean > 0 ? weeklyStd / mean : Infinity
      xyz = cv < 0.5 ? 'X' : cv <= 1 ? 'Y' : 'Z'
    }

    // Customers (cashbook = many unknown walk-ins, so it's not one "customer")
    const named = Array.from(customerCtn.entries()).filter(([k]) => k !== 'cashbook')
    const namedTotal = named.reduce((a, [, v]) => a + v, 0)
    const topCustomerShare = namedTotal > 0 ? Math.max(...named.map(([, v]) => v)) / namedTotal : null

    // Lost customers: bought this at least twice, nothing in 60+ days, while the
    // product was still selling to others or sitting in stock (so not a stock-out).
    const stillMoving = (lastSaleAgo != null && lastSaleAgo < 60) || es.some((e) => e.availableCtn > 0)
    const lost = stillMoving
      ? named
          .filter(([k]) => (customerBills.get(k)?.size ?? 0) >= 2 && (customerLast.get(k) ?? 0) >= 60)
          .map(([k, ctn]) => ({
            name: opts.customerNames?.get(k) ?? 'Unknown customer',
            bills: customerBills.get(k)?.size ?? 0,
            ctn: round(ctn, 1),
            lastSaleDaysAgo: customerLast.get(k) ?? 0,
          }))
          .sort((a, b) => b.ctn - a.ctn)
      : []
    const lostShare = namedTotal > 0 ? lost.reduce((a, c) => a + c.ctn, 0) / namedTotal : 0

    // ── Money ────────────────────────────────────────────────────────────
    const profitPerCtn = sold180 > 0 ? profit180 / sold180 : null
    const marginPct = revenue90 > 0 ? (profit90 / revenue90) * 100 : revenue180 > 0 ? (profit180 / revenue180) * 100 : null
    const marginPrev = revenuePrev90 > 0 ? (profitPrev90 / revenuePrev90) * 100 : null
    const marginDeltaPp = revenue90 > 0 && marginPrev != null ? (profit90 / revenue90) * 100 - marginPrev : null
    const priceNow = pcs30 > 0 ? rev30 / pcs30 : null
    const priceBefore = pcsPrice > 0 ? revPrice / pcsPrice : null
    const priceChangePct = priceNow && priceBefore ? ((priceNow - priceBefore) / priceBefore) * 100 : null

    const byDate = [...es].sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
    const costed = byDate.filter((e) => e.finalCost > 0)
    const costChangePct =
      costed.length >= 2 ? ((costed[0].finalCost - costed[1].finalCost) / costed[1].finalCost) * 100 : null

    // ── Physical: measured on buying entries first, manual value as fallback ──
    const qtyPerCtn = weightedAvg(es, (e) => e.qtyPerCtn, (e) => e.totalCtn)
    const entryCbm = weightedAvg(es, (e) => e.cbmPerCtn, (e) => e.totalCtn)
    const entryWeight = weightedAvg(es, (e) => e.weightPerCtn, (e) => e.totalCtn)
    const cbmPerCtn = entryCbm ?? (p.ctnCbm || null)
    const cbmSource: MeasureSource = entryCbm ? 'entries' : p.ctnCbm ? 'manual' : null
    const weightPerCtn = entryWeight ?? (p.ctnWeightKg || null)
    const weightSource: MeasureSource = entryWeight ? 'entries' : p.ctnWeightKg ? 'manual' : null
    const kgPerCbm = weightPerCtn && cbmPerCtn ? weightPerCtn / cbmPerCtn : null
    const profitPerCbm = profitPerCtn != null && cbmPerCtn ? profitPerCtn / cbmPerCtn : null

    // ── Stock ────────────────────────────────────────────────────────────
    const availableCtn = es.reduce((a, e) => a + e.availableCtn, 0)
    const pipelineCtn = es.reduce((a, e) => a + e.pipelineCtn, 0)
    const stockValue = es.reduce((a, e) => a + e.availableCtn * e.qtyPerCtn * e.finalCost, 0)
    const withStock = es.filter((e) => e.availableCtn > 0)
    const oldestStockDays = withStock.length ? Math.max(...withStock.map((e) => daysAgo(e.entryDate))) : null
    // Sold out: recent sales are zero because there was nothing to sell, not
    // because nobody wants it. Fall back to half the 180-day pace.
    const soldOut = availableCtn + pipelineCtn <= 0 && sold180 > 0
    if (soldOut && dailyDemand === 0) dailyDemand = (sold180 / activeDays(180)) * 0.5
    const daysOfCover = dailyDemand > 0 ? availableCtn / dailyDemand : null
    // How hard the money sitting in stock works: profit per year for each rupee
    // of stock at cost. Skipped for near-empty stock where the ratio means nothing.
    const stockReturn = stockValue >= 1000 ? (profit180 * 2) / stockValue : null

    return {
      p, sold30, soldPrev30, sold90, sold180, weekly, dailyDemand, trendPct, trend, xyz, weeklyStd,
      bills90: bills90.size, daysSinceLastSale: lastSaleAgo, firstSaleAgo,
      customers180: customerCtn.size, topCustomerShare, lost, lostShare,
      revenue90, profit90, profit180, profitPerCtn, marginPct, marginDeltaPp, priceChangePct, costChangePct,
      qtyPerCtn, cbmPerCtn, cbmSource, weightPerCtn, weightSource, kgPerCbm, profitPerCbm,
      availableCtn, pipelineCtn, stockValue, oldestStockDays, daysOfCover, soldOut, stockReturn,
      saleLines180: ss.filter((s) => daysAgo(s.billDate) < 180).length,
    }
  })

  // ── ABC by 180-day profit contribution ────────────────────────────────
  const abcBy = new Map<string, 'A' | 'B' | 'C'>()
  const positive = base.filter((b) => b.profit180 > 0).sort((a, b) => b.profit180 - a.profit180)
  const totalProfit = positive.reduce((a, b) => a + b.profit180, 0)
  let running = 0
  for (const b of positive) {
    const share = running / totalProfit // share *before* this product
    abcBy.set(b.p.id, share < 0.8 ? 'A' : share < 0.95 ? 'B' : 'C')
    running += b.profit180
  }

  // ── Score components, ranked against the other products ────────────────
  // Earning power: profit per CBM where we know CBM (container space is the
  // scarce resource), otherwise margin %.
  const earnRank = percentileRanks(base.map((b) => b.profitPerCbm ?? null))
  const marginRank = percentileRanks(base.map((b) => b.marginPct))
  const velocityRank = percentileRanks(base.map((b) => (b.sold90 > 0 ? b.dailyDemand : null)))

  return base.map((b, i) => {
    const signals: ProductInsight['signals'] = []
    const enoughData = b.saleLines180 >= 3 && b.firstSaleAgo >= 30
    const deadStock = b.availableCtn > 0 && (b.daysSinceLastSale == null || b.daysSinceLastSale >= 90)

    const earn = earnRank[i] ?? marginRank[i]
    const trendScore = b.trendPct == null ? null : clamp(50 + b.trendPct / 2)
    const velocity = velocityRank[i] ?? (b.sold180 > 0 ? 0 : null)
    const marginTrend = b.marginDeltaPp == null ? null : clamp(50 + b.marginDeltaPp * 5)
    const spread =
      b.customers180 === 0
        ? null
        : clamp(Math.min(100, b.customers180 * 20) - (b.topCustomerShare != null && b.topCustomerShare > 0.7 ? 30 : 0))
    const age = b.oldestStockDays == null ? 100 : clamp(100 - ((b.oldestStockDays - 60) / 180) * 100)

    const scoreParts = [
      { key: 'earn', label: b.profitPerCbm != null ? 'Profit per CBM' : 'Margin %', weight: 25, value: earn },
      { key: 'trend', label: 'Sales trend', weight: 20, value: trendScore },
      { key: 'velocity', label: 'Selling speed', weight: 20, value: velocity },
      { key: 'marginTrend', label: 'Margin trend', weight: 15, value: marginTrend },
      { key: 'spread', label: 'Customer spread', weight: 10, value: spread },
      { key: 'age', label: 'Stock age', weight: 10, value: age },
    ]
    // Missing parts are skipped and the rest re-weighted
    const known = scoreParts.filter((s) => s.value != null)
    const knownWeight = known.reduce((a, s) => a + s.weight, 0)
    const score = enoughData && knownWeight >= 50
      ? Math.round(known.reduce((a, s) => a + (s.value as number) * s.weight, 0) / knownWeight)
      : null

    let label: InsightLabel
    if (deadStock) label = 'dead'
    else if (score == null) label = 'new'
    else label = score >= 70 ? 'star' : score >= 55 ? 'good' : score >= 40 ? 'watch' : 'bad'

    // ── Reorder ──────────────────────────────────────────────────────────
    const override = opts.overrides?.get(b.p.id) ?? null
    const adjust = override ? 1 + clamp(override.demandAdjustPct, -100, 300) / 100 : 1
    const demand = b.dailyDemand * adjust
    const z = 1.65 // ~95% service level
    const dailyStd = (b.weeklyStd / Math.sqrt(7)) * adjust
    const safety = z * dailyStd * Math.sqrt(opts.leadTimeDays)
    const reorderPoint = demand * opts.leadTimeDays + safety
    const target = demand * (opts.leadTimeDays + opts.coverDays) + safety
    const onHand = b.availableCtn + b.pipelineCtn
    let need = Math.max(0, target - onHand)

    // Market caution: shrink the order when demand or price is sliding
    const pricePressure = b.priceChangePct != null && b.priceChangePct < -5
    const marginSqueeze = b.marginDeltaPp != null && b.marginDeltaPp < -3 && (b.costChangePct == null || b.costChangePct < 3)
    const volumeLoss = b.trend === 'down' && (b.priceChangePct == null || Math.abs(b.priceChangePct) < 3)
    const customerLoss = b.lost.length > 0 && b.lostShare >= 0.3
    // We dropped the rate but buyers didn't come: the market is saturated
    const priceCutNoLift = b.priceChangePct != null && b.priceChangePct <= -3 && b.trend !== 'none' && b.trend !== 'up'
    const competitorPressure = pricePressure || marginSqueeze || volumeLoss || customerLoss || override?.tag === 'competitor'
    if (b.trend === 'down') need *= 0.7
    if (competitorPressure) need *= 0.8
    if (priceCutNoLift) need *= 0.85
    if (deadStock || override?.tag === 'discontinue' || override?.tag === 'hold') need = 0

    const spreadPct = b.xyz === 'Z' ? 0.5 : b.xyz === 'Y' ? 0.35 : 0.2
    const suggestMin = need > 0 ? Math.max(1, Math.floor(need * (1 - spreadPct))) : 0
    const suggestMax = need > 0 ? Math.max(suggestMin, Math.ceil(need * (1 + spreadPct))) : 0

    let reorderStatus: ReorderStatus
    if (demand === 0 || override?.tag === 'discontinue' || override?.tag === 'hold') reorderStatus = 'no-demand'
    else if (onHand <= reorderPoint) reorderStatus = 'now'
    else if (onHand <= reorderPoint + demand * 15) reorderStatus = 'soon'
    else if (onHand / demand > 180) reorderStatus = 'overstock'
    else reorderStatus = 'ok'

    const confidence: ProductInsight['confidence'] =
      !enoughData ? 'low' : b.xyz === 'X' && b.saleLines180 >= 10 ? 'high' : b.xyz === 'Z' ? 'low' : 'medium'

    // ── Signals ─────────────────────────────────────────────────────────
    const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
    if (override && override.tag !== 'none') {
      const what: Record<OverrideTag, string> = {
        none: '', discontinue: 'Marked discontinue — no reorder', hold: 'On hold — no reorder',
        competitor: 'You flagged competitor pressure', seasonal: 'Marked seasonal', push: 'Marked to push',
      }
      signals.push({ tone: override.tag === 'discontinue' || override.tag === 'hold' ? 'bad' : 'info', text: what[override.tag] })
    }
    if (override && override.demandAdjustPct !== 0)
      signals.push({ tone: 'info', text: `Your demand adjustment ${pct(override.demandAdjustPct)} applied to reorder` })
    if (customerLoss || b.lost.length >= 2)
      signals.push({
        tone: customerLoss ? 'bad' : 'warn',
        text: `${b.lost.length} regular customer${b.lost.length > 1 ? 's' : ''} stopped buying (${b.lost.slice(0, 3).map((c) => c.name).join(', ')}${b.lost.length > 3 ? '…' : ''})`,
      })
    if (deadStock) signals.push({ tone: 'bad', text: `No sale in ${b.daysSinceLastSale ?? '180+'} days with ${round(b.availableCtn, 1)} CTN in stock — clear it, don't reorder` })
    if (pricePressure) signals.push({ tone: 'bad', text: `Selling rate ${pct(b.priceChangePct!)} vs previous 90 days — possible competitor pressure` })
    if (priceCutNoLift)
      signals.push({ tone: 'bad', text: `Rate cut ${Math.abs(b.priceChangePct!).toFixed(0)}% but sales didn't pick up — market looks saturated, don't reorder big` })
    if (marginSqueeze) signals.push({ tone: 'warn', text: `Margin down ${Math.abs(b.marginDeltaPp!).toFixed(1)} pts while cost is flat` })
    if (volumeLoss) signals.push({ tone: 'warn', text: `Sales ${pct(b.trendPct!)} vs previous 30 days at the same price — customers may be buying elsewhere` })
    if (b.trend === 'up') signals.push({ tone: 'good', text: `Sales ${pct(b.trendPct!)} vs previous 30 days` })
    if (b.costChangePct != null && b.costChangePct > 5) signals.push({ tone: 'warn', text: `Landed cost per piece ${pct(b.costChangePct)} on the latest batch` })
    if (b.topCustomerShare != null && b.topCustomerShare > 0.7 && b.customers180 > 0)
      signals.push({ tone: 'warn', text: `One customer takes ${(b.topCustomerShare * 100).toFixed(0)}% of named sales` })
    if (b.oldestStockDays != null && b.oldestStockDays > 120 && !deadStock)
      signals.push({ tone: 'warn', text: `Oldest batch in stock is ${b.oldestStockDays} days old` })
    if (b.soldOut) signals.push({ tone: 'warn', text: 'Out of stock with nothing on the way — sales are being lost' })
    if (reorderStatus === 'now' && need > 0) signals.push({ tone: 'info', text: `Stock + pipeline below reorder point (${round(reorderPoint, 1)} CTN)` })
    if (b.stockReturn != null && b.stockReturn < 0.5 && !deadStock)
      signals.push({ tone: 'warn', text: `Stock money earns only ${b.stockReturn.toFixed(1)}× a year — too much stock for what it sells` })
    if (b.stockReturn != null && b.stockReturn >= 3)
      signals.push({ tone: 'good', text: `Stock money earns ${b.stockReturn.toFixed(1)}× a year` })
    if (reorderStatus === 'overstock') signals.push({ tone: 'warn', text: `More than 180 days of stock at the current selling speed` })
    if (b.kgPerCbm != null && b.kgPerCbm > 350) signals.push({ tone: 'info', text: `Heavy: ${b.kgPerCbm.toFixed(0)} kg/CBM — fills container weight before space; pair with light items` })
    if (b.kgPerCbm != null && b.kgPerCbm < 120) signals.push({ tone: 'info', text: `Light/bulky: ${b.kgPerCbm.toFixed(0)} kg/CBM — good filler next to heavy items` })
    if (!b.cbmPerCtn || !b.weightPerCtn) signals.push({ tone: 'info', text: `Missing ${[!b.weightPerCtn && 'weight', !b.cbmPerCtn && 'CBM'].filter(Boolean).join(' & ')} per CTN — add it on the product` })
    if (!enoughData && !deadStock) signals.push({ tone: 'info', text: 'Not enough sales history yet for a reliable score' })

    return {
      id: b.p.id,
      name: b.p.name,
      label,
      score,
      abc: abcBy.get(b.p.id) ?? 'C',
      xyz: b.xyz,
      sold30: round(b.sold30),
      soldPrev30: round(b.soldPrev30),
      sold90: round(b.sold90),
      sold180: round(b.sold180),
      weekly: b.weekly.map((w) => round(w)),
      dailyDemand: round(b.dailyDemand, 3),
      trendPct: b.trendPct == null ? null : round(b.trendPct, 1),
      trend: b.trend,
      bills90: b.bills90,
      daysSinceLastSale: b.daysSinceLastSale,
      customers180: b.customers180,
      topCustomerShare: b.topCustomerShare == null ? null : round(b.topCustomerShare, 3),
      lostCustomers: b.lost,
      revenue90: Math.round(b.revenue90),
      profit90: Math.round(b.profit90),
      profit180: Math.round(b.profit180),
      profitPerCtn: b.profitPerCtn == null ? null : Math.round(b.profitPerCtn),
      stockReturn: b.stockReturn == null ? null : round(b.stockReturn, 2),
      marginPct: b.marginPct == null ? null : round(b.marginPct, 1),
      marginDeltaPp: b.marginDeltaPp == null ? null : round(b.marginDeltaPp, 1),
      priceChangePct: b.priceChangePct == null ? null : round(b.priceChangePct, 1),
      costChangePct: b.costChangePct == null ? null : round(b.costChangePct, 1),
      qtyPerCtn: b.qtyPerCtn == null ? null : Math.round(b.qtyPerCtn),
      cbmPerCtn: b.cbmPerCtn == null ? null : round(b.cbmPerCtn, 4),
      cbmSource: b.cbmSource,
      weightPerCtn: b.weightPerCtn == null ? null : round(b.weightPerCtn, 1),
      weightSource: b.weightSource,
      kgPerCbm: b.kgPerCbm == null ? null : Math.round(b.kgPerCbm),
      profitPerCbm: b.profitPerCbm == null ? null : Math.round(b.profitPerCbm),
      availableCtn: round(b.availableCtn),
      pipelineCtn: round(b.pipelineCtn),
      stockValue: Math.round(b.stockValue),
      oldestStockDays: b.oldestStockDays,
      daysOfCover: b.daysOfCover == null ? null : Math.round(b.daysOfCover),
      reorderPoint: round(reorderPoint, 1),
      suggestMin,
      suggestMax,
      reorderStatus,
      confidence,
      scoreParts: scoreParts.map((s) => ({ ...s, value: s.value == null ? null : Math.round(s.value) })),
      signals,
      competitorPressure,
      priceCutNoLift,
      override,
    }
  })
}
