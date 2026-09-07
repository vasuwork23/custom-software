'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { apiGet, authHeaders } from '@/lib/api-client'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { cn } from '@/lib/utils'
import type { DateRange } from 'react-day-picker'
import { TrendChart, type TrendRow } from '@/components/reports/TrendChart'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'
type Granularity = 'day' | 'week' | 'month'

const PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  year: 'Year',
  custom: 'Custom',
}

const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  // 'auto' lets the API pick one step finer than the period; the toggle overrides it.
  const [granularity, setGranularity] = useState<Granularity | 'auto'>('auto')
  const [drillStack, setDrillStack] = useState<{ period: Period; dateRange?: DateRange; label: string }[]>([])
  const [withExpenses, setWithExpenses] = useState(true)
  const [loading, setLoading] = useState(true)
  const [showAvailableOnly, setShowAvailableOnly] = useState(true)
  const [archive, setArchive] = useState('')
  const [reportTab, setReportTab] = useState('pnl')
  const [archives, setArchives] = useState<{ name: string; resetDate: string; sellBills: number }[]>([])
  const [pnl, setPnl] = useState<{
    summary: { revenue: number; cost: number; grossProfit: number; totalExpenses: number; netProfit: number; marginPct: number; netMarginPct: number; ctnSold: number }
    chart: { period: string; start: string; end: string; revenue: number; cost: number; grossProfit: number; netProfit: number }[]
    granularity?: Granularity
    dateRange?: { start: string; end: string }
    byProduct: { productName: string; revenue: number; cost: number; profit: number; marginPct: number }[]
    byCompany: { companyName: string; isCashbook?: boolean; isBankSale?: boolean; revenue: number; profit: number; outstanding: number }[]
  } | null>(null)
  const [stock, setStock] = useState<{
    summary: {
      totalProducts: number
      totalAvailableCtn: number
      totalInTransit: number
      totalInChina: number
      totalInIndia: number
      totalAvailablePcs?: number
      totalStockCost?: number
      totalIndiaProducts?: number
      totalIndiaAvailableCtn?: number
      totalIndiaAvailablePcs?: number
      totalIndiaStockCost?: number
    }
    rows: {
      productName: string
      totalCtnBought: number
      availableCtn: number
      chinaWarehouse: number
      inTransit: number
      indiaWarehouse: number
      lockedEntries: number
      availablePcs?: number
      costPerPiece?: number
      totalCost?: number
    }[]
    indiaRows?: {
      productName: string
      totalCtnBought: number
      availableCtn: number
      availablePcs?: number
      costPerPiece?: number
      totalCost?: number
    }[]
  } | null>(null)
  const [selling, setSelling] = useState<{
    summary: { totalBills: number; totalRevenue: number; totalProfit: number; avgBillValue: number }
    topProducts: { productName?: string; revenue: number; profit: number }[]
    topCompanies: { companyName?: string; revenue: number; profit: number }[]
    bills: { billNumber: number; billDate: string; companyName: string; productCount: number; amount: number; profit: number }[]
  } | null>(null)
  const [buying, setBuying] = useState<{
    summary: { totalEntries: number; totalAmount: number; totalGiven: number; totalRemaining: number }
    paymentStatus: { paid: number; unpaid: number; partiallypaid: number }
    monthlyTrend: { _id: string; totalAmount: number; count: number }[]
    entries: { entryDate: string; productName: string; totalCtn: number; totalAmount: number; givenAmount: number; remainingAmount: number; currentStatus: string }[]
  } | null>(null)

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    params.set('period', period === 'custom' ? 'custom' : period)
    if (period === 'custom' && dateRange?.from) {
      params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
      if (dateRange.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    }
    // Empty means the live database; a name points every query at a frozen year.
    if (archive) params.set('archive', archive)
    return params
  }, [period, dateRange, archive])

  const handleExport = useCallback(
    async (reportType: 'pnl' | 'stock' | 'selling' | 'buying', formatType: 'pdf' | 'excel') => {
      const params = buildParams()
      if (reportType === 'pnl') params.set('withExpenses', String(withExpenses))
      if (reportType === 'stock') params.set('availableOnly', String(showAvailableOnly))
      const url = `/api/reports/export?format=${formatType}&reportType=${reportType}&${params.toString()}`
      try {
        const res = await fetch(url, { headers: authHeaders() })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          toast.error(j.message ?? 'Export failed')
          return
        }
        const blob = await res.blob()
        const disposition = res.headers.get('Content-Disposition')
        const match = disposition?.match(/filename="?([^";]+)"?/)
        const filename = match?.[1] ?? `report-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.${formatType === 'pdf' ? 'pdf' : 'xlsx'}`
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = filename
        link.click()
        URL.revokeObjectURL(link.href)
        toast.success('Download started')
      } catch {
        toast.error('Export failed')
      }
    },
    [buildParams, withExpenses, showAvailableOnly]
  )

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const base = buildParams().toString()
    const pnlParams =
      `${base}&withExpenses=${withExpenses}` + (granularity === 'auto' ? '' : `&granularity=${granularity}`)
    try {
      const [pnlRes, stockRes, sellingRes, buyingRes] = await Promise.all([
        apiGet<typeof pnl>(`/api/reports/pnl?${pnlParams}`),
        apiGet<typeof stock>(`/api/reports/stock${archive ? `?archive=${encodeURIComponent(archive)}` : ''}`),
        apiGet<typeof selling>(`/api/reports/selling?${base}`),
        apiGet<typeof buying>(`/api/reports/buying?${base}`),
      ])
      if (pnlRes.success) setPnl(pnlRes.data)
      else toast.error(pnlRes.message)
      if (stockRes.success) setStock(stockRes.data)
      else toast.error(stockRes.message)
      if (sellingRes.success) setSelling(sellingRes.data)
      else toast.error(sellingRes.message)
      if (buyingRes.success) setBuying(buyingRes.data)
      else toast.error(buyingRes.message)
    } finally {
      setLoading(false)
    }
  }, [buildParams, withExpenses, archive, granularity])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    apiGet<{ archives: { name: string; resetDate: string; sellBills: number }[] }>(
      '/api/reports/archives'
    ).then((r) => { if (r.success) setArchives(r.data.archives) })
  }, [])

  /** Picking a period from the toolbar starts over: no drill trail, automatic granularity. */
  const selectPeriod = useCallback((p: Period) => {
    setPeriod(p)
    setGranularity('auto')
    setDrillStack([])
  }, [])

  const activeGranularity: Granularity = pnl?.granularity ?? 'day'
  const profitLabel = withExpenses ? 'Net Profit' : 'Gross Profit'

  const trendRangeLabel = pnl?.dateRange
    ? `${format(new Date(pnl.dateRange.start), 'd MMM yyyy')} – ${format(new Date(pnl.dateRange.end), 'd MMM yyyy')}`
    : ''

  const rangeDays = useMemo(() => {
    if (!pnl?.dateRange) return 0
    const from = new Date(pnl.dateRange.start).getTime()
    const to = new Date(pnl.dateRange.end).getTime()
    return Math.round((to - from) / 86_400_000) + 1
  }, [pnl?.dateRange])

  // Only offer a bucket size that yields a readable number of bars for this range.
  const allowedGranularities = useMemo(() => {
    const out: Granularity[] = []
    if (rangeDays > 1 && rangeDays <= 92) out.push('day')
    if (rangeDays > 7) out.push('week')
    if (rangeDays > 31) out.push('month')
    return out
  }, [rangeDays])

  const trendData: TrendRow[] = useMemo(() => {
    const rows = pnl?.chart ?? []
    const multiYear = new Set(rows.map((r) => r.start.slice(0, 4))).size > 1
    return rows.map((r) => {
      const from = parseISO(r.start)
      const to = parseISO(r.end)
      let label: string
      let rangeLabel: string
      if (activeGranularity === 'month') {
        label = format(from, multiYear ? 'MMM yyyy' : 'MMM')
        rangeLabel = format(from, 'MMMM yyyy')
      } else if (activeGranularity === 'week') {
        label = `${format(from, 'd')}–${format(to, 'd MMM')}`
        rangeLabel = `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`
      } else {
        label = format(from, 'd MMM')
        rangeLabel = format(from, 'EEEE, d MMM yyyy')
      }
      return {
        ...r,
        label,
        rangeLabel,
        profit: withExpenses ? r.netProfit : r.grossProfit,
        canDrill: r.start !== r.end,
      }
    })
  }, [pnl?.chart, activeGranularity, withExpenses])

  /** Clicking a bar narrows every report on the page to that bucket's dates. */
  const drillInto = useCallback(
    (row: TrendRow) => {
      if (!row?.canDrill || !row.start || !row.end) return
      setDrillStack((stack) => [...stack, { period, dateRange, label: trendRangeLabel }])
      setPeriod('custom')
      setDateRange({ from: parseISO(row.start), to: parseISO(row.end) })
      setGranularity('auto')
    },
    [period, dateRange, trendRangeLabel]
  )

  const drillBack = useCallback(() => {
    setDrillStack((stack) => {
      const previous = stack[stack.length - 1]
      if (previous) {
        setPeriod(previous.period)
        setDateRange(previous.dateRange)
        setGranularity('auto')
      }
      return stack.slice(0, -1)
    })
  }, [])

  const displayRows = showAvailableOnly
    ? (stock?.rows ?? []).filter((r) => r.availableCtn > 0)
    : (stock?.rows ?? [])
  const displayIndiaRows = showAvailableOnly
    ? (stock?.indiaRows ?? []).filter((r) => r.availableCtn > 0)
    : (stock?.indiaRows ?? [])

  const chinaStockCost = Number(displayRows.reduce((s, r) => s + (r.totalCost ?? 0), 0).toFixed(2))
  const indiaStockCost = Number(displayIndiaRows.reduce((s, r) => s + ((r as { totalCost?: number }).totalCost ?? 0), 0).toFixed(2))

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="P&L, stock, selling, and buying reports." />

      <Tabs value={reportTab} onValueChange={setReportTab} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="pnl">P&L</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="selling">Selling</TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 items-center gap-1 rounded-md bg-muted p-1">
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  variant={period === p ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => selectPeriod(p)}
                >
                  {PERIOD_LABEL[p]}
                </Button>
              ))}
            </div>
            {period === 'custom' && (
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder="Select date range"
              />
            )}
            {archives.length > 0 && (
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={archive}
                onChange={(e) => setArchive(e.target.value)}
              >
                <option value="">This year (live)</option>
                {archives.map((a) => (
                  <option key={a.name} value={a.name}>
                    Up to {a.resetDate} ({a.sellBills} bills)
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {archive && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            Reading a past year, frozen at the reset on {archive.slice(-10)}. Nothing here can be edited.
          </p>
        )}

        {loading ? (
          <div className="space-y-6">
            <TableSkeleton rows={4} columns={6} />
            <TableSkeleton rows={5} columns={5} />
            <TableSkeleton rows={4} columns={4} />
          </div>
        ) : (
          <>
            <TabsContent value="pnl" className="space-y-6">
              {/* P&L Section */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>P&L Report</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Show:</span>
                    <Button
                      variant={withExpenses ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => setWithExpenses(false)}
                    >
                      Without Expenses
                    </Button>
                    <Button
                      variant={withExpenses ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setWithExpenses(true)}
                    >
                      With Expenses
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {pnl && (
                    <>
                      <div className={cn('grid gap-4 sm:grid-cols-2', withExpenses ? 'lg:grid-cols-7' : 'lg:grid-cols-5')}>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Total Revenue</p>
                            <p className="text-xl font-semibold"><AmountDisplay amount={pnl.summary.revenue} /></p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Total Cost</p>
                            <p className="text-xl font-semibold"><AmountDisplay amount={pnl.summary.cost} /></p>
                          </CardContent>
                        </Card>
                        <Card className={cn(!withExpenses && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10')}>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Gross Profit</p>
                            <p className={cn('text-xl font-semibold', pnl.summary.grossProfit < 0 ? 'text-destructive' : !withExpenses && 'text-emerald-600')}>
                              <AmountDisplay amount={pnl.summary.grossProfit} />
                            </p>
                          </CardContent>
                        </Card>
                        {withExpenses && (
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Total Expenses</p>
                              <p className="text-xl font-semibold text-orange-500"><AmountDisplay amount={pnl.summary.totalExpenses} /></p>
                            </CardContent>
                          </Card>
                        )}
                        {withExpenses && (
                          <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10">
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Net Profit</p>
                              <p className={cn('text-xl font-semibold', pnl.summary.netProfit < 0 ? 'text-destructive' : 'text-emerald-600')}>
                                <AmountDisplay amount={pnl.summary.netProfit} />
                              </p>
                            </CardContent>
                          </Card>
                        )}
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Profit Margin</p>
                            <p className="text-xl font-semibold">
                              {withExpenses
                                ? pnl.summary.netMarginPct.toFixed(2)
                                : pnl.summary.marginPct.toFixed(2)}
                              %
                            </p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">CTN Sold</p>
                            <p className="text-xl font-semibold text-blue-600">
                              {pnl.summary.ctnSold}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="mb-2 font-medium">By Product</h4>
                          <div className="rounded-md border overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-muted/80">
                                <tr className="border-b">
                                  <th className="p-2 text-left">Product</th>
                                  <th className="p-2 text-right">Revenue</th>
                                  <th className="p-2 text-right">Cost</th>
                                  <th className="p-2 text-right">Profit</th>
                                  <th className="p-2 text-right">Margin %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pnl.byProduct.map((r, i) => (
                                  <tr key={i} className="border-b">
                                    <td className="p-2">{r.productName}</td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.revenue} /></td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.cost} /></td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.profit} /></td>
                                    <td className="p-2 text-right">{r.marginPct.toFixed(2)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div>
                          <h4 className="mb-2 font-medium">By Company</h4>
                          <div className="rounded-md border overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-muted/80">
                                <tr className="border-b">
                                  <th className="p-2 text-left">Company</th>
                                  <th className="p-2 text-right">Revenue</th>
                                  <th className="p-2 text-right">Profit</th>
                                  <th className="p-2 text-right">Outstanding</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pnl.byCompany.map((r, i) => (
                                  <tr key={i} className="border-b">
                                    <td className="p-2">
                                      {r.isCashbook ? (
                                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-semibold">
                                          💵 CASHBOOK
                                        </span>
                                      ) : r.isBankSale ? (
                                        <span className="inline-flex items-center gap-1.5">
                                          {r.companyName}
                                          <span className="text-blue-700 dark:text-blue-400 text-[10px] font-semibold tracking-wide">🏦 BANK</span>
                                        </span>
                                      ) : r.companyName}
                                    </td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.revenue} /></td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.profit} /></td>
                                    <td className="p-2 text-right"><AmountDisplay amount={r.outstanding} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleExport('pnl', 'pdf')}>Download PDF</Button>
                        <Button variant="outline" size="sm" onClick={() => handleExport('pnl', 'excel')}>Download Excel</Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Trend Section */}
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle>Profit Trend</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {trendRangeLabel}
                      {activeGranularity && trendData.length > 1 && ` · ${GRANULARITY_LABEL[activeGranularity].toLowerCase()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {drillStack.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={drillBack}>
                        ← Back
                      </Button>
                    )}
                    {allowedGranularities.length > 1 && (
                      <div className="flex gap-1 rounded-md border p-0.5 bg-muted/40">
                        {allowedGranularities.map((g) => (
                          <Button
                            key={g}
                            variant={activeGranularity === g ? 'default' : 'ghost'}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setGranularity(g)}
                          >
                            {GRANULARITY_LABEL[g]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {trendData.length > 1 ? (
                    <>
                      <div className="h-[300px]">
                        <TrendChart data={trendData} profitLabel={profitLabel} onDrill={drillInto} />
                      </div>
                      {trendData.some((r) => r.canDrill) && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Click a bar to narrow every report on this page to that {activeGranularity}.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      This period covers a single {activeGranularity} — there is nothing to
                      break down yet. Pick a longer period to see the trend.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stock" className="space-y-6">
              <p className="text-sm text-muted-foreground">
                A live snapshot of the stock on hand — the period buttons above do not apply to it.
              </p>
              {/* Stock Section */}
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle>Stock Report</CardTitle>
                    {stock && (
                      <div className="flex flex-wrap gap-4 pt-1">
                        <div>
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">China Stock</p>
                          <p className="text-lg font-bold text-blue-600">
                            ₹{chinaStockCost.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="text-muted-foreground self-end pb-0.5 text-lg font-light">+</div>
                        <div>
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">India Stock</p>
                          <p className="text-lg font-bold text-emerald-600">
                            ₹{indiaStockCost.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="text-muted-foreground self-end pb-0.5 text-lg font-light">=</div>
                        <div className="rounded-lg border bg-muted/40 px-3 py-1">
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Stock Valuation</p>
                          <p className="text-xl font-bold">
                            ₹{(chinaStockCost + indiaStockCost).toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex gap-1 rounded-md border p-0.5 bg-muted/40">
                      <Button
                        variant={showAvailableOnly ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setShowAvailableOnly(true)}
                      >
                        Available Only
                      </Button>
                      <Button
                        variant={!showAvailableOnly ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setShowAvailableOnly(false)}
                      >
                        All Products
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleExport('stock', 'pdf')}>Download PDF</Button>
                      <Button variant="outline" size="sm" onClick={() => handleExport('stock', 'excel')}>Download Excel</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {stock && (
                    <Tabs defaultValue="china">
                      <TabsList>
                        <TabsTrigger value="china">🏭 China Products</TabsTrigger>
                        <TabsTrigger value="india">🇮🇳 India Products</TabsTrigger>
                      </TabsList>

                      {/* China Products Tab */}
                      <TabsContent value="china" className="space-y-4 mt-4">
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Products</p>
                              <p className="text-xl font-semibold">{displayRows.length}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">In China</p>
                              <p className="text-xl font-semibold">{displayRows.reduce((s, r) => s + (r.chinaWarehouse ?? 0), 0)}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">In Transit</p>
                              <p className="text-xl font-semibold">{displayRows.reduce((s, r) => s + (r.inTransit ?? 0), 0)}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Available (India)</p>
                              <p className="text-xl font-semibold">{displayRows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Available PCS</p>
                              <p className="text-xl font-semibold">
                                {displayRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0).toLocaleString('en-IN')}
                              </p>
                            </CardContent>
                          </Card>
                          <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Stock Valuation</p>
                              <p className="text-xl font-semibold text-blue-600">
                                ₹{chinaStockCost.toLocaleString('en-IN')}
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                        <div className="rounded-md border overflow-x-auto max-h-[550px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10">
                              <tr className="border-b bg-muted/80">
                                <th className="p-3 text-left font-medium">Product</th>
                                <th className="p-3 text-right font-medium">Total CTN</th>
                                <th className="p-3 text-right font-medium">Available CTN</th>
                                <th className="p-3 text-right font-medium">China</th>
                                <th className="p-3 text-right font-medium">In Transit</th>
                                <th className="p-3 text-right font-medium">India</th>
                                <th className="p-3 text-right font-medium">Total PCS</th>
                                <th className="p-3 text-right font-medium">Cost/Piece (₹)</th>
                                <th className="p-3 text-right font-medium">Total Cost (₹)</th>
                                <th className="p-3 text-right font-medium">Locked</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayRows.map((r, i) => (
                                <tr key={i} className="border-b hover:bg-muted/30">
                                  <td className="p-3">{r.productName}</td>
                                  <td className="p-3 text-right">{r.totalCtnBought}</td>
                                  <td className="p-3 text-right">{r.availableCtn}</td>
                                  <td className="p-3 text-right">{r.chinaWarehouse}</td>
                                  <td className="p-3 text-right">{r.inTransit}</td>
                                  <td className="p-3 text-right">{r.indiaWarehouse}</td>
                                  <td className="p-3 text-right">{r.availablePcs?.toLocaleString('en-IN')}</td>
                                  <td className="p-3 text-right text-emerald-600">
                                    {r.costPerPiece && r.costPerPiece > 0
                                      ? `₹${r.costPerPiece.toFixed(5)}`
                                      : (r.availablePcs ?? 0) === 0
                                        ? <span className="text-gray-300">—</span>
                                        : <span className="text-orange-500">No cost</span>}
                                  </td>
                                  <td className="p-3 text-right text-blue-600 font-medium">
                                    {r.totalCost && r.totalCost > 0
                                      ? `₹${Number(r.totalCost).toLocaleString('en-IN')}`
                                      : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="p-3 text-right">{r.lockedEntries}</td>
                                </tr>
                              ))}
                            </tbody>
                            {displayRows.length > 0 && (
                              <tfoot className="sticky bottom-0 z-10">
                                <tr className="border-t-2 bg-muted/80 font-semibold">
                                  <td className="p-3">Total</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.totalCtnBought ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.chinaWarehouse ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.inTransit ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.indiaWarehouse ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0).toLocaleString('en-IN')}</td>
                                  <td className="p-3 text-right">—</td>
                                  <td className="p-3 text-right text-blue-700">
                                    ₹{chinaStockCost.toLocaleString('en-IN')}
                                  </td>
                                  <td className="p-3 text-right">{displayRows.reduce((s, r) => s + (r.lockedEntries ?? 0), 0)}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </TabsContent>

                      {/* India Products Tab */}
                      <TabsContent value="india" className="space-y-4 mt-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Products</p>
                              <p className="text-xl font-semibold">{displayIndiaRows.length}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Available CTN</p>
                              <p className="text-xl font-semibold">{displayIndiaRows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Available PCS</p>
                              <p className="text-xl font-semibold">
                                {displayIndiaRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0).toLocaleString('en-IN')}
                              </p>
                            </CardContent>
                          </Card>
                          <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10">
                            <CardContent className="pt-4">
                              <p className="text-xs text-muted-foreground">Stock Valuation</p>
                              <p className="text-xl font-semibold text-emerald-600">
                                ₹{indiaStockCost.toLocaleString('en-IN')}
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                        {displayIndiaRows.length > 0 ? (
                          <div className="rounded-md border overflow-x-auto max-h-[550px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 z-10">
                                <tr className="border-b bg-muted/80">
                                  <th className="p-3 text-left font-medium">Product</th>
                                  <th className="p-3 text-right font-medium">Total CTN</th>
                                  <th className="p-3 text-right font-medium">Available CTN</th>
                                  <th className="p-3 text-right font-medium">Total PCS</th>
                                  <th className="p-3 text-right font-medium">Cost/Piece (₹)</th>
                                  <th className="p-3 text-right font-medium">Total Cost (₹)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {displayIndiaRows.map((r, i) => (
                                  <tr key={i} className="border-b hover:bg-muted/30">
                                    <td className="p-3">{r.productName}</td>
                                    <td className="p-3 text-right">{r.totalCtnBought}</td>
                                    <td className="p-3 text-right">{r.availableCtn}</td>
                                    <td className="p-3 text-right">
                                      {r.availablePcs?.toLocaleString('en-IN') ?? '—'}
                                    </td>
                                    <td className="p-3 text-right text-emerald-600">
                                      {r.costPerPiece && r.costPerPiece > 0
                                        ? `₹${r.costPerPiece.toFixed(2)}`
                                        : (r.availablePcs ?? 0) === 0
                                          ? <span className="text-gray-300">—</span>
                                          : <span className="text-orange-500">No cost</span>}
                                    </td>
                                    <td className="p-3 text-right text-emerald-600 font-medium">
                                      {r.totalCost && r.totalCost > 0
                                        ? `₹${Number(r.totalCost).toLocaleString('en-IN')}`
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="sticky bottom-0 z-10">
                                <tr className="border-t-2 bg-muted/80 font-semibold">
                                  <td className="p-3">Total</td>
                                  <td className="p-3 text-right">{displayIndiaRows.reduce((s, r) => s + (r.totalCtnBought ?? 0), 0)}</td>
                                  <td className="p-3 text-right">{displayIndiaRows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</td>
                                  <td className="p-3 text-right">
                                    {displayIndiaRows.reduce((s, r) => s + (r.availablePcs ?? 0), 0).toLocaleString('en-IN')}
                                  </td>
                                  <td className="p-3 text-right">—</td>
                                  <td className="p-3 text-right text-emerald-700">
                                    ₹{indiaStockCost.toLocaleString('en-IN')}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No India products with stock.</p>
                        )}
                      </TabsContent>
                    </Tabs>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="selling" className="space-y-6">
              {/* Selling Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Selling Report</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selling && (
                    <>
                      <div className="grid gap-4 sm:grid-cols-4">
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Total Bills</p>
                            <p className="text-xl font-semibold">{selling.summary.totalBills}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Total Revenue</p>
                            <p className="text-xl font-semibold"><AmountDisplay amount={selling.summary.totalRevenue} /></p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Total Profit</p>
                            <p className="text-xl font-semibold"><AmountDisplay amount={selling.summary.totalProfit} /></p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-xs text-muted-foreground">Avg Bill Value</p>
                            <p className="text-xl font-semibold"><AmountDisplay amount={selling.summary.avgBillValue} /></p>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="h-[260px]">
                          <h4 className="mb-2 font-medium">Top 5 Products by Revenue</h4>
                          <ResponsiveContainer width="100%" height="90%">
                            <BarChart data={selling.topProducts} margin={{ top: 5, right: 5, left: 5, bottom: 60 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="productName" angle={-45} textAnchor="end" height={60} />
                              <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(v: number) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                              <Bar dataKey="revenue" fill="#22c55e" name="Revenue" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="h-[260px]">
                          <h4 className="mb-2 font-medium">Top 5 Companies by Revenue</h4>
                          <ResponsiveContainer width="100%" height="90%">
                            <BarChart data={selling.topCompanies} margin={{ top: 5, right: 5, left: 5, bottom: 60 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="companyName" angle={-45} textAnchor="end" height={60} />
                              <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(v: number) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                              <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="rounded-md border overflow-x-auto max-h-[280px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-muted/80">
                            <tr className="border-b">
                              <th className="p-3 text-left font-medium">Bill No</th>
                              <th className="p-3 text-left font-medium">Date</th>
                              <th className="p-3 text-left font-medium">Company</th>
                              <th className="p-3 text-right font-medium">Products</th>
                              <th className="p-3 text-right font-medium">Amount</th>
                              <th className="p-3 text-right font-medium">Profit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selling.bills.map((b, i) => (
                              <tr key={i} className="border-b">
                                <td className="p-3">{b.billNumber}</td>
                                <td className="p-3">{format(new Date(b.billDate), 'dd MMM yyyy')}</td>
                                <td className="p-3">{b.companyName}</td>
                                <td className="p-3 text-right">{b.productCount}</td>
                                <td className="p-3 text-right"><AmountDisplay amount={b.amount} /></td>
                                <td className="p-3 text-right"><AmountDisplay amount={b.profit} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleExport('selling', 'pdf')}>Download PDF</Button>
                        <Button variant="outline" size="sm" onClick={() => handleExport('selling', 'excel')}>Download Excel</Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          {/* Buying Section */}
          {/* <Card>
            <CardHeader>
              <CardTitle>Buying Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {buying && (
                <>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Total Entries</p>
                        <p className="text-xl font-semibold">{buying.summary.totalEntries}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Total Invested</p>
                        <p className="text-xl font-semibold"><AmountDisplay amount={buying.summary.totalAmount} /></p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Total Paid</p>
                        <p className="text-xl font-semibold"><AmountDisplay amount={buying.summary.totalGiven} /></p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Total Remaining</p>
                        <p className="text-xl font-semibold"><AmountDisplay amount={buying.summary.totalRemaining} /></p>
                      </CardContent>
                    </Card>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Payment Status</h4>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Paid', value: buying.paymentStatus.paid },
                                { name: 'Unpaid', value: buying.paymentStatus.unpaid },
                                { name: 'Partially Paid', value: buying.paymentStatus.partiallypaid },
                              ].filter((d) => d.value > 0)}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={2}
                              dataKey="value"
                              label={({ name, value }) => `${name}: ${value}`}
                            >
                              {[0, 1, 2].map((i) => (
                                <Cell key={i} fill={PIE_COLORS[i]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="h-[220px]">
                      <h4 className="mb-2 font-medium">Monthly Trend</h4>
                      <ResponsiveContainer width="100%" height="90%">
                        <BarChart data={buying.monthlyTrend} margin={{ top: 5, right: 5, left: 5, bottom: 30 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="_id" />
                          <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Amount']} />
                          <Bar dataKey="totalAmount" fill="#8b5cf6" name="Amount" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="rounded-md border overflow-x-auto max-h-[280px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr className="border-b">
                          <th className="p-3 text-left font-medium">Date</th>
                          <th className="p-3 text-left font-medium">Product</th>
                          <th className="p-3 text-right font-medium">CTN</th>
                          <th className="p-3 text-right font-medium">Total</th>
                          <th className="p-3 text-right font-medium">Given</th>
                          <th className="p-3 text-right font-medium">Remaining</th>
                          <th className="p-3 text-center font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buying.entries.map((e, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-3">{format(new Date(e.entryDate), 'dd MMM yyyy')}</td>
                            <td className="p-3">{e.productName}</td>
                            <td className="p-3 text-right">{e.totalCtn}</td>
                            <td className="p-3 text-right"><AmountDisplay amount={e.totalAmount} /></td>
                            <td className="p-3 text-right"><AmountDisplay amount={e.givenAmount} /></td>
                            <td className="p-3 text-right"><AmountDisplay amount={e.remainingAmount} /></td>
                            <td className="p-3 text-center">
                              <span className={cn(
                                'rounded px-2 py-0.5 text-xs',
                                e.currentStatus === 'paid' && 'bg-green-100 text-green-800 dark:bg-green-900/30',
                                e.currentStatus === 'unpaid' && 'bg-red-100 text-red-800 dark:bg-red-900/30',
                                e.currentStatus === 'partiallypaid' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30'
                              )}>
                                {e.currentStatus.replace('partiallypaid', 'Partial')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleExport('buying', 'pdf')}>Download PDF</Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport('buying', 'excel')}>Download Excel</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card> */}
          </>
        )}
      </Tabs>
    </div>
  )
}
