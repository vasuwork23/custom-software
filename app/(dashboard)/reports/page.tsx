'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

const PIE_COLORS = ['#22c55e', '#ef4444', '#eab308']

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [withExpenses, setWithExpenses] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pnl, setPnl] = useState<{
    summary: { revenue: number; cost: number; grossProfit: number; totalExpenses: number; netProfit: number; marginPct: number; netMarginPct: number }
    chart: { period: string; revenue: number; cost: number; grossProfit: number; netProfit: number }[]
    byProduct: { productName: string; revenue: number; cost: number; profit: number; marginPct: number }[]
    byCompany: { companyName: string; revenue: number; profit: number; outstanding: number }[]
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
    return params
  }, [period, dateRange])

  const handleExport = useCallback(
    async (reportType: 'pnl' | 'stock' | 'selling' | 'buying', formatType: 'pdf' | 'excel') => {
      const params = buildParams()
      if (reportType === 'pnl') params.set('withExpenses', String(withExpenses))
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
    [buildParams, withExpenses]
  )

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const base = buildParams().toString()
    const pnlParams = `${base}&withExpenses=${withExpenses}`
    try {
      const [pnlRes, stockRes, sellingRes, buyingRes] = await Promise.all([
        apiGet<typeof pnl>(`/api/reports/pnl?${pnlParams}`),
        apiGet<typeof stock>('/api/reports/stock'),
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
  }, [buildParams, withExpenses])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="P&L, stock, selling, and buying reports." />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Period</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            {(['today', 'week', 'month', 'year'] as const).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriod(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Button>
            ))}
            <Button
              variant={period === 'custom' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod('custom')}
            >
              Custom Range
            </Button>
          </div>
          {period === 'custom' && (
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder="Select date range"
            />
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-6">
          <TableSkeleton rows={4} columns={6} />
          <TableSkeleton rows={5} columns={5} />
          <TableSkeleton rows={4} columns={4} />
        </div>
      ) : (
        <>
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
                  <div className={cn('grid gap-4 sm:grid-cols-2', withExpenses ? 'lg:grid-cols-6' : 'lg:grid-cols-4')}>
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
                  </div>
                  {pnl.chart.length > 0 && (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={pnl.chart}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="period" />
                          <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => `₹${Number(v).toLocaleString('en-IN')}`} />
                          <Legend />
                          <Line type="monotone" dataKey="revenue" stroke="#22c55e" name="Revenue" />
                          <Line type="monotone" dataKey="cost" stroke="#ef4444" name="Cost" />
                          <Line type="monotone" dataKey="grossProfit" stroke="#3b82f6" name="Gross Profit" />
                          {withExpenses && <Line type="monotone" dataKey="netProfit" stroke="#8b5cf6" name="Net Profit" />}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">By Product</h4>
                      <div className="rounded-md border overflow-x-auto max-h-[240px] overflow-y-auto">
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
                      <div className="rounded-md border overflow-x-auto max-h-[240px] overflow-y-auto">
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
                                <td className="p-2">{r.companyName}</td>
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
                        ₹{Number(stock.summary.totalStockCost ?? 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="text-muted-foreground self-end pb-0.5 text-lg font-light">+</div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">India Stock</p>
                      <p className="text-lg font-bold text-emerald-600">
                        ₹{Number(stock.summary.totalIndiaStockCost ?? 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="text-muted-foreground self-end pb-0.5 text-lg font-light">=</div>
                    <div className="rounded-lg border bg-muted/40 px-3 py-1">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Stock Valuation</p>
                      <p className="text-xl font-bold">
                        ₹{(
                          Number(stock.summary.totalStockCost ?? 0) +
                          Number(stock.summary.totalIndiaStockCost ?? 0)
                        ).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleExport('stock', 'pdf')}>Download PDF</Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('stock', 'excel')}>Download Excel</Button>
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
                          <p className="text-xl font-semibold">{stock.summary.totalProducts}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">In China</p>
                          <p className="text-xl font-semibold">{stock.summary.totalInChina}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">In Transit</p>
                          <p className="text-xl font-semibold">{stock.summary.totalInTransit}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Available (India)</p>
                          <p className="text-xl font-semibold">{stock.summary.totalInIndia}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Available PCS</p>
                          <p className="text-xl font-semibold">
                            {stock.summary.totalAvailablePcs?.toLocaleString('en-IN')}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Stock Valuation</p>
                          <p className="text-xl font-semibold text-blue-600">
                            ₹{Number(stock.summary.totalStockCost ?? 0).toLocaleString('en-IN')}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    <div className="rounded-md border overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
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
                          {stock.rows.map((r, i) => (
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
                          {stock.rows.length > 0 && (
                            <tr className="border-t-2 bg-muted/40 font-semibold">
                              <td className="p-3">Total</td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.totalCtnBought ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.chinaWarehouse ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.inTransit ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.indiaWarehouse ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.summary.totalAvailablePcs?.toLocaleString('en-IN')}</td>
                              <td className="p-3 text-right">—</td>
                              <td className="p-3 text-right text-blue-700">
                                ₹{Number(stock.summary.totalStockCost ?? 0).toLocaleString('en-IN')}
                              </td>
                              <td className="p-3 text-right">{stock.rows.reduce((s, r) => s + (r.lockedEntries ?? 0), 0)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>

                  {/* India Products Tab */}
                  <TabsContent value="india" className="space-y-4 mt-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Products</p>
                          <p className="text-xl font-semibold">{stock.summary.totalIndiaProducts ?? 0}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Available CTN</p>
                          <p className="text-xl font-semibold">{stock.summary.totalIndiaAvailableCtn ?? 0}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Available PCS</p>
                          <p className="text-xl font-semibold">
                            {(stock.summary.totalIndiaAvailablePcs ?? 0).toLocaleString('en-IN')}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10">
                        <CardContent className="pt-4">
                          <p className="text-xs text-muted-foreground">Stock Valuation</p>
                          <p className="text-xl font-semibold text-emerald-600">
                            ₹{Number(stock.summary.totalIndiaStockCost ?? 0).toLocaleString('en-IN')}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    {stock.indiaRows && stock.indiaRows.length > 0 ? (
                      <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="p-3 text-left font-medium">Product</th>
                              <th className="p-3 text-right font-medium">Total CTN</th>
                              <th className="p-3 text-right font-medium">Available CTN</th>
                              <th className="p-3 text-right font-medium">Total PCS</th>
                              <th className="p-3 text-right font-medium">Cost/Piece (₹)</th>
                              <th className="p-3 text-right font-medium">Total Cost (₹)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stock.indiaRows.map((r, i) => (
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
                            <tr className="border-t-2 bg-muted/40 font-semibold">
                              <td className="p-3">Total</td>
                              <td className="p-3 text-right">{stock.indiaRows.reduce((s, r) => s + (r.totalCtnBought ?? 0), 0)}</td>
                              <td className="p-3 text-right">{stock.indiaRows.reduce((s, r) => s + (r.availableCtn ?? 0), 0)}</td>
                              <td className="p-3 text-right">
                                {(stock.summary.totalIndiaAvailablePcs ?? 0).toLocaleString('en-IN')}
                              </td>
                              <td className="p-3 text-right">—</td>
                              <td className="p-3 text-right text-emerald-700">
                                ₹{Number(stock.summary.totalIndiaStockCost ?? 0).toLocaleString('en-IN')}
                              </td>
                            </tr>
                          </tbody>
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
    </div>
  )
}
