'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowDownRight, ArrowUpRight, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { apiGet } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { DateRange } from 'react-day-picker'

type DashboardPeriod = 'today' | 'week' | 'month' | 'year' | 'custom'

interface DashboardPnl {
  summary: {
    revenue: number
    cost: number
    grossProfit: number
    expenses: number
    netProfit: number
    margin: number
  }
  trends: {
    revenue: number
    cost: number
    grossProfit: number
    expenses: number
    netProfit: number
  }
  chartData: { label: string; revenue: number; cost: number; netProfit: number }[]
  topCompanies: { name: string; revenue: number; profit: number }[]
  recentBills: { id: string; billNumber: number; company: string; amount: number; date: string | Date }[]
}

interface DashboardStats {
  chinaBankBalance: number
  cashBalance: number
  totalOutstanding: number
  totalPositiveOutstanding: number
  totalNegativeOutstanding: number
  pendingPaymentsCount: number
  totalLiabilities: number
  totalInvestment: number
  allTimeNetProfit: number
  localConst: number
}

interface DashboardInventoryValue {
  total: number
  chinaProducts: number
  indiaProducts: number
}

interface DashboardChinaBankHealth {
  balance: number
  lockedThisMonth: number
  readyToLock: number
  readyToLockProducts: { productId: string; productName: string }[]
}

interface DashboardStockMovement {
  ctnBoughtThisPeriod: number
  ctnSoldThisPeriod: number
}

interface DashboardTopProduct {
  name: string
  unitsSold: number
  profit: number
  margin: number
}

interface DashboardJackBalance {
  name: string
  balance: number
  isDefault: boolean
}

interface DashboardBankBalance {
  accountName: string
  balance: number
  type: string
  id: string
}

interface DashboardCashFlow {
  moneyIn: number
  moneyOut: number
  netCashFlow: number
}

interface DashboardMonthlyRow {
  month: string
  revenue: number
  cost: number
  profit: number
  expenses: number
  netProfit: number
  margin: number
}

interface DashboardOutstandingCompany {
  name: string
  outstanding: number
  oldestBillDate: string | Date
  daysPending: number
}

interface DashboardOutstandingAging {
  within30Days: number
  days30to60: number
  over60Days: number
  companies: DashboardOutstandingCompany[]
}

interface DashboardDeadStockRow {
  productName: string
  availableCtn: number
  inventoryValue: number
  daysSinceLastSale: number
}

interface ExtendedDashboardStats extends DashboardStats {
  inventoryValue: DashboardInventoryValue
  chinaBankHealth: DashboardChinaBankHealth
  stockMovement: DashboardStockMovement
  topProducts: DashboardTopProduct[]
  jackBalances: DashboardJackBalance[]
  bankBalances: DashboardBankBalance[]
  cashFlow: DashboardCashFlow
  monthlyComparison: DashboardMonthlyRow[]
  outstandingAging: DashboardOutstandingAging
  deadStock: DashboardDeadStockRow[]
  unsentWhatsappBills: number
  unlockedReadyEntries: number
  containers?: {
    active: number
    inTransit: number
    atCustoms: number
    overdueEta: number
  }
}

interface ActivityItem {
  icon: string
  type: string
  description: string
  amount?: number
  createdAt: string | Date
  link?: string
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const [period, setPeriod] = useState<DashboardPeriod>('today')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [loadingPnl, setLoadingPnl] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [pnl, setPnl] = useState<DashboardPnl | null>(null)
  const [stats, setStats] = useState<ExtendedDashboardStats | null>(null)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)

  const buildPnlParams = useCallback(() => {
    const params = new URLSearchParams()
    params.set('period', period)
    if (period === 'custom' && dateRange?.from && dateRange.to) {
      params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
      params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    }
    return params
  }, [period, dateRange])

  const fetchPnl = useCallback(async () => {
    if (period === 'custom' && (!dateRange?.from || !dateRange.to)) return
    setLoadingPnl(true)
    try {
      const params = buildPnlParams().toString()
      const res = await apiGet<DashboardPnl>(`/api/dashboard/pnl?${params}`)
      if (!res.success) {
        toast.error(res.message)
        return
      }
      setPnl(res.data)
    } catch {
      toast.error('Failed to load P&L data')
    } finally {
      setLoadingPnl(false)
    }
  }, [buildPnlParams, period, dateRange])

  const buildStatsParams = useCallback(() => {
    const params = new URLSearchParams()
    params.set('period', period)
    if (period === 'custom' && dateRange?.from && dateRange.to) {
      params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
      params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    }
    return params
  }, [period, dateRange])

  const fetchStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const params = buildStatsParams().toString()
      const res = await apiGet<ExtendedDashboardStats>(`/api/dashboard/stats?${params}`)
      if (!res.success) {
        toast.error(res.message)
        return
      }
      setStats(res.data)
    } catch {
      toast.error('Failed to load dashboard stats')
    } finally {
      setLoadingStats(false)
    }
  }, [buildStatsParams])

  const fetchActivity = useCallback(async () => {
    setLoadingActivity(true)
    try {
      const res = await apiGet<ActivityItem[]>('/api/dashboard/activity')
      if (!res.success) {
        toast.error(res.message)
        return
      }
      setActivity(res.data)
    } catch {
      toast.error('Failed to load recent activity')
    } finally {
      setLoadingActivity(false)
    }
  }, [])

  useEffect(() => {
    fetchPnl()
  }, [fetchPnl])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchActivity()
  }, [fetchActivity])

  const handlePeriodChange = (next: DashboardPeriod) => {
    setPeriod(next)
    if (next !== 'custom') setDateRange(undefined)
  }

  const renderTrend = (value: number) => {
    const rounded = Number.isFinite(value) ? value.toFixed(1) : '0.0'
    if (value > 0) {
      return (
        <span className="inline-flex items-center text-xs font-medium text-emerald-600">
          <ArrowUpRight className="mr-1 h-3 w-3" />
          {rounded}%
        </span>
      )
    }
    if (value < 0) {
      return (
        <span className="inline-flex items-center text-xs font-medium text-red-600">
          <ArrowDownRight className="mr-1 h-3 w-3" />
          {rounded}%
        </span>
      )
    }
    return <span className="text-xs text-muted-foreground">0.0%</span>
  }

  const margin = pnl?.summary.margin ?? 0
  const marginColor =
    margin > 20 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user?.fullName ?? user?.email}.`}
      />

      {/* Period filter bar */}
      <div className="sticky top-[-1px] z-10 border-b bg-background/95 pb-3 pt-1 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border bg-muted/40 p-1 text-xs sm:text-sm">
            {(
              [
                ['today', 'Today'],
                ['week', 'This Week'],
                ['month', 'This Month'],
                ['year', 'This Year'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handlePeriodChange(value)}
                className={cn(
                  'rounded px-2 py-1 sm:px-3 sm:py-1.5 font-medium',
                  period === value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={period === 'custom' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePeriodChange('custom')}
            >
              Custom
            </Button>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              disabled={period !== 'custom'}
              placeholder="Select custom range"
            />
          </div>
        </div>
      </div>

      {/* P&L summary row */}
      <section className="space-y-4">
        {loadingPnl ? (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="space-y-2 pt-4">
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-6 w-24 rounded bg-muted" />
                  <div className="h-3 w-16 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : pnl ? (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="text-xl font-semibold">
                  <AmountDisplay amount={pnl.summary.revenue} />
                </p>
                {renderTrend(pnl.trends.revenue)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="text-xl font-semibold">
                  <AmountDisplay amount={pnl.summary.cost} />
                </p>
                {renderTrend(pnl.trends.cost)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Gross Profit</p>
                <p
                  className={cn(
                    'text-xl font-semibold',
                    pnl.summary.grossProfit < 0 && 'text-red-600'
                  )}
                >
                  <AmountDisplay amount={pnl.summary.grossProfit} />
                </p>
                {renderTrend(pnl.trends.grossProfit)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Expenses</p>
                <p className="text-xl font-semibold">
                  <AmountDisplay amount={pnl.summary.expenses} />
                </p>
                {renderTrend(pnl.trends.expenses)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Net Profit</p>
                <p
                  className={cn(
                    'text-2xl font-bold',
                    pnl.summary.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'
                  )}
                >
                  <AmountDisplay amount={pnl.summary.netProfit} />
                </p>
                {renderTrend(pnl.trends.netProfit)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-1">
                <p className="text-xs text-muted-foreground">Margin %</p>
                <p className={cn('text-2xl font-bold', marginColor)}>
                  {margin.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Net profit / revenue
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                No P&amp;L data available for this period.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* P&L chart (temporarily disabled)
      <section>
        <Card>
          <CardHeader>
            <CardTitle>P&amp;L Overview</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px] sm:h-[320px]">
            {loadingPnl ? (
              <div className="flex h-full items-center justify-center">
                <TableSkeleton rows={5} columns={4} />
              </div>
            ) : hasChartData ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pnl!.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) =>
                      [`₹${Number(v).toLocaleString('en-IN')}`, '']
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    name="Revenue"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#f97316"
                    name="Cost"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="netProfit"
                    stroke="#22c55e"
                    name="Net Profit"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
                <p>No sales data for this period.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      */}

      {/* Quick stats row */}
      <section>
        {loadingStats ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="space-y-2 pt-4">
                  <div className="h-3 w-28 rounded bg-muted" />
                  <div className="h-6 w-24 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stats ? (
          <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">China Bank Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Current Balance</p>
                  <p
                    className={cn(
                      'text-lg font-semibold',
                      stats.chinaBankHealth.balance < 0 && 'text-destructive'
                    )}
                  >
                    <AmountDisplay amount={stats.chinaBankHealth.balance} />
                  </p>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Locked this month</span>
                  <span>
                    <AmountDisplay amount={stats.chinaBankHealth.lockedThisMonth} />
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Ready to lock</span>
                  <span>{stats.chinaBankHealth.readyToLock}</span>
                </div>
                {stats.chinaBankHealth.readyToLock > 0 && (() => {
                  const products = stats.chinaBankHealth.readyToLockProducts ?? []
                  const href = products.length === 1
                    ? `/products/${products[0].productId}`
                    : '/products'
                  const label = products.length === 1
                    ? `${stats.chinaBankHealth.readyToLock} ${stats.chinaBankHealth.readyToLock === 1 ? 'entry' : 'entries'} ready to lock — ${products[0].productName}`
                    : `${stats.chinaBankHealth.readyToLock} entries ready to lock`
                  return (
                    <Button asChild variant="outline" size="sm">
                      <Link href={href}>{label}</Link>
                    </Button>
                  )
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
                <Button asChild variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent">
                  <Link href="/reports">View stock report →</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">China Products</span>
                  <span className="font-medium">
                    <AmountDisplay amount={stats.inventoryValue.chinaProducts} />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">India Products</span>
                  <span className="font-medium">
                    <AmountDisplay amount={stats.inventoryValue.indiaProducts} />
                  </span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-bold text-emerald-600">
                    <AmountDisplay amount={stats.inventoryValue.total} />
                  </span>
                </div>
              </CardContent>
            </Card>

            <Link href="/banks">
              <Card className="transition hover:shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Total Cash &amp; Bank Balance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(() => {
                    const bankTotal = stats.bankBalances.reduce((sum, b) => sum + b.balance, 0)
                    const grandTotal = stats.cashBalance + bankTotal
                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cash</span>
                          <span className={cn('font-medium', stats.cashBalance < 0 && 'text-destructive')}>
                            <AmountDisplay amount={stats.cashBalance} />
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Banks</span>
                          <span className={cn('font-medium', bankTotal < 0 && 'text-destructive')}>
                            <AmountDisplay amount={bankTotal} />
                          </span>
                        </div>
                        <div className="border-t pt-2 flex justify-between">
                          <span className="font-semibold">Total</span>
                          <span className={cn('text-lg font-bold', grandTotal < 0 ? 'text-destructive' : 'text-emerald-600')}>
                            <AmountDisplay amount={grandTotal} />
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </CardContent>
              </Card>
            </Link>

            <Link href="/companies">
              <Card className="transition hover:shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Net Outstanding</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To Receive</span>
                    <span className={cn('font-medium', stats.totalPositiveOutstanding > 0 && 'text-red-600')}>
                      <AmountDisplay amount={stats.totalPositiveOutstanding} />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credit</span>
                    <span className={cn('font-medium', stats.totalNegativeOutstanding > 0 && 'text-emerald-600')}>
                      <AmountDisplay amount={stats.totalNegativeOutstanding} />
                    </span>
                  </div>
                  <div className="border-t pt-2 flex justify-between">
                    <span className="font-semibold">Net</span>
                    <span
                      className={cn(
                        'text-lg font-bold',
                        (stats.totalPositiveOutstanding - stats.totalNegativeOutstanding) >= 0
                          ? 'text-red-600'
                          : 'text-emerald-600'
                      )}
                    >
                      <AmountDisplay amount={stats.totalPositiveOutstanding - stats.totalNegativeOutstanding} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>

            {/* Containers card — hidden for now
            {stats.containers != null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Containers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Active</span>
                    <span>{stats.containers.active}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>In Transit</span>
                    <span className="text-blue-600">{stats.containers.inTransit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>At Customs</span>
                    <span className="text-amber-600">{stats.containers.atCustoms}</span>
                  </div>
                  {stats.containers.overdueEta > 0 && (
                    <p className="text-xs text-red-600 font-medium">
                      {stats.containers.overdueEta} container(s) overdue ETA
                    </p>
                  )}
                  {stats.containers.atCustoms > 0 && (
                    <p className="text-xs text-amber-600 font-medium">
                      {stats.containers.atCustoms} container(s) in customs
                    </p>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href="/containers">View Containers</Link>
                  </Button>
                </CardContent>
              </Card>
            )} */}
          </div>

          {/* Grand total & investment formula rows */}
          {(() => {
            const bankTotal = stats.bankBalances.reduce((sum, b) => sum + b.balance, 0)
            const cashAndBanks = stats.cashBalance + bankTotal
            const toReceive = stats.totalPositiveOutstanding
            const liabilities = stats.totalLiabilities ?? 0
            const grandTotal = stats.inventoryValue.total + stats.chinaBankHealth.balance + cashAndBanks + toReceive + liabilities

            const grandTotalItems = [
              { label: 'China Bank', value: stats.chinaBankHealth.balance },
              { label: 'Inventory', value: stats.inventoryValue.total },
              { label: 'Cash & Banks', value: cashAndBanks },
              { label: 'To Receive', value: toReceive },
              { label: 'Liabilities', value: liabilities },
            ]

            const creditOutstanding = stats.totalNegativeOutstanding
            const netProfit = stats.allTimeNetProfit
            const investmentTotal = stats.totalInvestment + creditOutstanding + netProfit + stats.localConst
            const diff = investmentTotal - grandTotal

            const items = [
              { label: 'Total Investment', value: stats.totalInvestment },
              { label: 'Outstanding (Credit)', value: creditOutstanding },
              { label: 'Net Profit (All Time)', value: netProfit },
              { label: 'Local Const', value: stats.localConst },
            ]

            return (
              <>
                <div className="mt-3 rounded-lg border bg-muted/20 px-6 py-4">
                  <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-4">
                    {grandTotalItems.map((item, idx) => (
                      <div key={item.label} className="flex items-center gap-x-5">
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                          <p className={cn('font-semibold text-base', item.value < 0 ? 'text-red-600' : '')}>
                            <AmountDisplay amount={item.value} />
                          </p>
                        </div>
                        {idx < grandTotalItems.length - 1 && (
                          <span className="text-xl text-muted-foreground font-light select-none">+</span>
                        )}
                      </div>
                    ))}
                    <span className="text-xl font-medium text-muted-foreground select-none px-1">=</span>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground mb-1">Grand Total</p>
                      <p className={cn('text-xl font-bold', grandTotal >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        <AmountDisplay amount={grandTotal} />
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-center gap-x-3 overflow-x-auto">
                    {items.map((item, idx) => (
                      <div key={item.label} className="flex items-center gap-x-3 shrink-0">
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                          <p className={cn('font-semibold text-base', item.value < 0 ? 'text-red-600' : '')}>
                            <AmountDisplay amount={item.value} />
                          </p>
                        </div>
                        {idx < items.length - 1 && (
                          <span className="text-xl text-muted-foreground font-light select-none">+</span>
                        )}
                      </div>
                    ))}
                    <span className="text-xl font-medium text-muted-foreground select-none shrink-0">=</span>
                    <div className="text-center shrink-0">
                      <p className="text-xs text-muted-foreground mb-1">Total</p>
                      <p className={cn('text-xl font-bold', investmentTotal >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        <AmountDisplay amount={investmentTotal} />
                      </p>
                    </div>
                    <span className="text-xl text-muted-foreground font-light select-none shrink-0">-</span>
                    <div className="text-center shrink-0">
                      <p className="text-xs text-muted-foreground mb-1">Grand Total</p>
                      <p className="font-semibold text-base">
                        <AmountDisplay amount={grandTotal} />
                      </p>
                    </div>
                    <span className="text-xl font-medium text-muted-foreground select-none shrink-0">=</span>
                    <div className="text-center shrink-0">
                      <p className="text-xs text-muted-foreground mb-1">Difference</p>
                      <p className={cn('text-xl font-bold', diff >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        <AmountDisplay amount={diff} />
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )
          })()}
          </>
        ) : null}
      </section>

      {/* Outstanding aging & top products */}
      {stats && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Outstanding Aging</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-emerald-500/60 bg-emerald-50/40 p-2">
                  <p className="text-[11px] text-emerald-700">0-30 days</p>
                  <p className="text-sm font-semibold">
                    <AmountDisplay amount={stats.outstandingAging.within30Days} />
                  </p>
                </div>
                <div className="rounded border border-amber-500/60 bg-amber-50/40 p-2">
                  <p className="text-[11px] text-amber-700">30-60 days</p>
                  <p className="text-sm font-semibold">
                    <AmountDisplay amount={stats.outstandingAging.days30to60} />
                  </p>
                </div>
                <div className="rounded border border-red-500/60 bg-red-50/60 p-2">
                  <p className="text-[11px] text-red-700">60+ days</p>
                  <p className="text-sm font-semibold">
                    <AmountDisplay amount={stats.outstandingAging.over60Days} />
                  </p>
                </div>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Company</th>
                      <th className="p-2 text-right font-medium">Outstanding</th>
                      <th className="p-2 text-right font-medium">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.outstandingAging.companies.map((c, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="p-2">{c.name}</td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={c.outstanding} />
                        </td>
                        <td
                          className={cn(
                            'p-2 text-right',
                            c.daysPending > 60
                              ? 'text-red-600'
                              : c.daysPending > 30
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          )}
                        >
                          {c.daysPending}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/companies">View All</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 5 Products (this period)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Product</th>
                      <th className="p-2 text-right font-medium">Units</th>
                      <th className="p-2 text-right font-medium">Profit</th>
                      <th className="p-2 text-right font-medium">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topProducts.map((p, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="p-2">{p.name}</td>
                        <td className="p-2 text-right">{p.unitsSold}</td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={p.profit} />
                        </td>
                        <td className="p-2 text-right">{p.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/reports">View Full Report</Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Monthly comparison table */}
      {stats && (
        <section>
          <Card>
            <CardHeader>
              <CardTitle>Monthly Comparison (last 6 months)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Month</th>
                      <th className="p-2 text-right font-medium">Revenue</th>
                      <th className="p-2 text-right font-medium">Cost</th>
                      <th className="p-2 text-right font-medium">Gross Profit</th>
                      <th className="p-2 text-right font-medium">Expenses</th>
                      <th className="p-2 text-right font-medium">Net Profit</th>
                      <th className="p-2 text-right font-medium">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthlyComparison.map((m, idx, arr) => (
                      <tr
                        key={m.month}
                        className={cn(
                          'border-b last:border-0',
                          idx === arr.length - 1 && 'bg-muted/40'
                        )}
                      >
                        <td className="p-2">{m.month}</td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={m.revenue} />
                        </td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={m.cost} />
                        </td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={m.profit} />
                        </td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={m.expenses} />
                        </td>
                        <td
                          className={cn(
                            'p-2 text-right',
                            m.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'
                          )}
                        >
                          <AmountDisplay amount={m.netProfit} />
                        </td>
                        <td className="p-2 text-right">{m.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/reports">View Full Report</Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Recent activity, Sophia balances, bank balances */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[260px] space-y-2 overflow-y-auto text-sm">
            {loadingActivity ? (
              <TableSkeleton rows={5} columns={2} />
            ) : activity && activity.length > 0 ? (
              activity.map((a, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted'
                  )}
                  onClick={() => a.link && (window.location.href = a.link)}
                >
                  <span className="mt-0.5">{a.icon}</span>
                  <div className="flex-1">
                    <p className="text-xs">{a.description}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {typeof a.amount === 'number' && (
                    <span className="text-xs font-medium">
                      <AmountDisplay amount={a.amount} />
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No recent activity.</p>
            )}
          </CardContent>
        </Card>

        {stats && (
          <Card>
            <CardHeader>
              <CardTitle>Sophia Balances</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[260px] space-y-2 overflow-y-auto text-sm">
              {stats.jackBalances.map((j) => (
                    <div
                      key={j.name}
                      className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer"
                      onClick={() =>
                        (window.location.href = `/sophia/${encodeURIComponent(j.name)}`)
                      }
                >
                  <div>
                    <p className="text-xs font-medium">
                      {j.name}
                      {j.isDefault && ' (Default)'}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'text-xs font-semibold',
                      j.balance < 0 && 'text-red-600'
                    )}
                  >
                    ¥{j.balance.toLocaleString('en-IN')}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {stats && (
          <Card>
            <CardHeader>
              <CardTitle>All Bank Balances</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[260px] space-y-2 overflow-y-auto text-sm">
              {stats.bankBalances.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer"
                  onClick={() =>
                    (window.location.href = `/banks/${encodeURIComponent(b.id)}`)
                  }
                >
                  <div>
                    <p className="text-xs font-medium">{b.accountName}</p>
                    <p className="text-[11px] text-muted-foreground">{b.type}</p>
                  </div>
                  <p
                    className={cn(
                      'text-xs font-semibold',
                      b.balance < 0 && 'text-red-600'
                    )}
                  >
                    <AmountDisplay amount={b.balance} />
                  </p>
                </div>
              ))}
              <div className="mt-2 border-t pt-2 text-xs flex justify-between">
                <span>Total</span>
                <span className="font-semibold">
                  <AmountDisplay
                    amount={stats.bankBalances.reduce(
                      (sum, b) => sum + b.balance,
                      0
                    )}
                  />
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recent bills + dead stock */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Recent Sale Bills</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href="/sale-bills">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingPnl ? (
              <TableSkeleton rows={5} columns={4} />
            ) : pnl && pnl.recentBills.length > 0 ? (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Bill No</th>
                      <th className="p-2 text-left font-medium">Company</th>
                      <th className="p-2 text-right font-medium">Amount</th>
                      <th className="p-2 text-right font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.recentBills.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b hover:bg-muted/40 cursor-pointer"
                        onClick={() => (window.location.href = `/sale-bills/${b.id}`)}
                      >
                        <td className="p-2">{b.billNumber}</td>
                        <td className="p-2">{b.company}</td>
                        <td className="p-2 text-right">
                          <AmountDisplay amount={b.amount} />
                        </td>
                        <td className="p-2 text-right text-xs text-muted-foreground">
                          {format(new Date(b.date), 'dd MMM yyyy')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No bills in this period.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Dead Stock Alert — hidden for now
        {stats && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Dead Stock Alert</CardTitle>
              <Button asChild variant="outline" size="sm">
                <Link href="/reports">View Stock Report</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.deadStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No dead stock detected in India warehouse.
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Product</th>
                        <th className="p-2 text-right font-medium">Available CTN</th>
                        <th className="p-2 text-right font-medium">Value</th>
                        <th className="p-2 text-right font-medium">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.deadStock.map((d, idx) => (
                        <tr
                          key={idx}
                          className={cn(
                            'border-b last:border-0',
                            d.daysSinceLastSale > 60
                              ? 'bg-red-50/60'
                              : d.daysSinceLastSale > 30
                              ? 'bg-amber-50/60'
                              : ''
                          )}
                        >
                          <td className="p-2">{d.productName}</td>
                          <td className="p-2 text-right">{d.availableCtn}</td>
                          <td className="p-2 text-right">
                            <AmountDisplay
                              amount={
                                Number.isFinite(d.inventoryValue)
                                  ? d.inventoryValue
                                  : 0
                              }
                            />
                          </td>
                          <td className="p-2 text-right">{d.daysSinceLastSale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        */}
      </section>
    </div>
  )
}

