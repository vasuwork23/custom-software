'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowRight, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import type { InsightLabel } from '@/lib/product-insights'
import { LABELS, REORDER, num, type InsightRow, type InsightsResponse, type Source } from './insights/types'
import { Sparkline, weeklyTitles } from './insights/Sparkline'
import { AbcXyzGrid } from './insights/AbcXyzGrid'
import { ContainerPlanner } from './insights/ContainerPlanner'
import { OverrideEditor } from './insights/OverrideEditor'

const SIGNAL_TONE = {
  good: { icon: '▲', className: 'text-green-700 dark:text-green-400' },
  warn: { icon: '!', className: 'text-amber-700 dark:text-amber-400' },
  bad: { icon: '✕', className: 'text-red-700 dark:text-red-400' },
  info: { icon: 'i', className: 'text-muted-foreground' },
}

type Filter = 'all' | InsightLabel | 'reorder' | 'pressure' | 'tagged'
type View = 'table' | 'matrix' | 'planner'
type SortKey =
  | 'name' | 'score' | 'sold30' | 'trendPct' | 'profitPerCtn' | 'profitPerCbm'
  | 'marginPct' | 'stockReturn' | 'kgPerCbm' | 'availableCtn' | 'daysOfCover' | 'suggestMax'

function TrendCell({ p }: { p: InsightRow }) {
  if (p.trend === 'none' || p.trendPct == null) return <span className="text-muted-foreground">—</span>
  const Icon = p.trend === 'up' ? ArrowUp : p.trend === 'down' ? ArrowDown : ArrowRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 tabular-nums',
        p.trend === 'up' && 'text-green-700 dark:text-green-400',
        p.trend === 'down' && 'text-red-700 dark:text-red-400',
        p.trend === 'flat' && 'text-muted-foreground'
      )}
      title={`Last 30 days ${p.sold30} CTN vs previous 30 days ${p.soldPrev30} CTN`}
    >
      <Icon className="h-3.5 w-3.5" />
      {p.trendPct > 0 ? '+' : ''}
      {p.trendPct.toFixed(0)}%
    </span>
  )
}

function SourceTag({ source }: { source: InsightRow['cbmSource'] }) {
  if (source !== 'manual') return null
  return <span className="ml-1 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground" title="Entered manually on the product">man</span>
}

export function ProductInsights() {
  const [source, setSource] = useState<Source>('china')
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [leadInput, setLeadInput] = useState('')
  const [coverInput, setCoverInput] = useState('30')
  const [applied, setApplied] = useState<{ lead: string; cover: string }>({ lead: '', cover: '30' })
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [view, setView] = useState<View>('table')
  const [matrix, setMatrix] = useState<{ abc: string; xyz: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ source, coverDays: applied.cover || '30' })
    if (applied.lead) params.set('leadTimeDays', applied.lead)
    const res = await apiGet<InsightsResponse>(`/api/reports/insights?${params}`)
    if (res.success) setData(res.data)
    else toast.error(res.message)
    setLoading(false)
  }, [source, applied])

  useEffect(() => {
    load()
  }, [load])

  const switchSource = (s: Source) => {
    setSource(s)
    setLeadInput('')
    setApplied((a) => ({ ...a, lead: '' }))
    setFilter('all')
    setMatrix(null)
    setExpanded(null)
    if (s === 'india' && view === 'planner') setView('table')
  }

  const applyInputs = () => setApplied({ lead: leadInput.trim(), cover: coverInput.trim() || '30' })

  const products = useMemo(() => data?.products ?? [], [data])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: products.length, star: 0, good: 0, watch: 0, bad: 0, dead: 0, new: 0, reorder: 0, pressure: 0, tagged: 0 }
    for (const p of products) {
      c[p.label]++
      if (p.override) c.tagged++
      if (p.reorderStatus === 'now') c.reorder++
      if (p.competitorPressure) c.pressure++
    }
    return c
  }, [products])

  const totals = useMemo(() => {
    const deadValue = products.filter((p) => p.label === 'dead').reduce((a, p) => a + p.stockValue, 0)
    const toOrder = products.filter((p) => p.reorderStatus === 'now' || p.reorderStatus === 'soon')
    const cbm = toOrder.reduce((a, p) => a + ((p.suggestMin + p.suggestMax) / 2) * (p.cbmPerCtn ?? 0), 0)
    const missingCbm = toOrder.filter((p) => p.suggestMax > 0 && !p.cbmPerCtn).length
    return { deadValue, cbm, missingCbm, toOrder: toOrder.filter((p) => p.suggestMax > 0).length }
  }, [products])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (matrix && (p.abc !== matrix.abc || (p.xyz ?? '-') !== matrix.xyz)) return false
      if (filter === 'all') return true
      if (filter === 'tagged') return !!p.override
      if (filter === 'reorder') return p.reorderStatus === 'now'
      if (filter === 'pressure') return p.competitorPressure
      return p.label === filter
    })
    return list.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir
      const av = a[sort.key] as number | null
      const bv = b[sort.key] as number | null
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nulls always last
      if (bv == null) return -1
      return (av - bv) * sort.dir
    })
  }, [products, filter, search, sort, matrix])

  const isChina = source === 'china'
  const detailHref = (id: string) => (isChina ? `/products/${id}` : `/products/india/${id}`)

  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn('p-2 font-medium whitespace-nowrap', className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((s.dir * -1) as 1 | -1) : k === 'name' ? 1 : -1 }))}
      >
        {children}
        {sort.key === k ? (
          sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )

  const colCount = isChina ? 13 : 11

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex h-10 items-center gap-1 rounded-md bg-muted p-1">
          {(['china', 'india'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchSource(s)}
              className={cn(
                'h-8 rounded-sm px-3 text-sm transition-colors',
                source === s ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s === 'china' ? '🏭 China' : '🇮🇳 India'}
            </button>
          ))}
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Lead time (days)</span>
          <Input
            type="number"
            min={1}
            className="h-10 w-28"
            value={leadInput}
            placeholder={data ? String(data.leadTimeAuto) : ''}
            onChange={(e) => setLeadInput(e.target.value)}
            onBlur={applyInputs}
            onKeyDown={(e) => e.key === 'Enter' && applyInputs()}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Keep stock for (days)</span>
          <Input
            type="number"
            min={7}
            className="h-10 w-28"
            value={coverInput}
            onChange={(e) => setCoverInput(e.target.value)}
            onBlur={applyInputs}
            onKeyDown={(e) => e.key === 'Enter' && applyInputs()}
          />
        </label>
        <Input
          className="h-10 w-full sm:w-56 sm:ml-auto"
          placeholder="Search product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {data && (
        <p className="text-xs text-muted-foreground">
          Lead time {data.leadTimeDays} days
          {applied.lead
            ? ' (your value)'
            : data.leadTimeMeasured
            ? ` (measured from ${data.leadTimeMeasured.samples} delivered container entries)`
            : isChina
            ? ' (default — no delivered containers yet; type your usual time)'
            : ' (default for local purchase)'}
          {' · '}Based on the last 180 days of sales
          {data.includesArchive && ' (including last year’s archive)'}
          {' · '}Updated {format(new Date(data.generatedAt), 'd MMM, HH:mm')}
          {' · '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? 'Hide' : 'How is this calculated?'}
          </button>
        </p>
      )}

      {showHelp && (
        <Card>
          <CardContent className="grid gap-4 pt-4 text-sm md:grid-cols-2">
            <div className="space-y-2">
              <p className="font-medium">Health score (0–100)</p>
              <p className="text-muted-foreground">
                Each part is ranked against your other products, then combined:{' '}
                {isChina ? 'profit per CBM' : 'margin %'} 25%, sales trend 20%, selling speed 20%, margin trend 15%,
                customer spread 10%, stock age 10%. Missing parts are skipped. ⭐ 70+ · ✅ 55–69 · 👀 40–54 · ⚠️ below 40 ·
                💀 in stock but no sale for 90+ days.
              </p>
              <p className="font-medium">A / B / C and X / Y / Z</p>
              <p className="text-muted-foreground">
                A = products earning the first 80% of your 180-day profit, B = next 15%, C = the rest. X = steady weekly
                sales, Y = up and down, Z = unpredictable. AX = never run out. CZ = don&apos;t reorder.
              </p>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Reorder suggestion</p>
              <p className="text-muted-foreground">
                Daily demand = 60% last-30-day pace + 40% last-90-day pace. Need = demand × (lead time + keep-stock days)
                + safety stock − (India stock + factory + China WH + in transit). Cut 30% if sales are falling and 20% more
                if there are competitor signals. Shown as a range: wider when demand is unpredictable.
              </p>
              <p className="font-medium">Competitor signals</p>
              <p className="text-muted-foreground">
                We can&apos;t see competitors, only the effects on your sales: your selling rate dropping 5%+, margin
                shrinking while cost is flat, sales falling at the same price, or regular customers (2+ bills) who
                haven&apos;t bought in 60 days while others still do. Treat them as warnings, not facts.
              </p>
              <p className="font-medium">Return on stock · saturation</p>
              <p className="text-muted-foreground">
                Return on stock = yearly profit (180 days × 2) ÷ money in stock at cost. 2× means each ₹1 in stock
                earns ₹2 a year; below 0.5× the stock is too big for what it sells. 📉 means you cut the rate 3%+ but
                sales still didn&apos;t rise — the market is saturated, so the reorder is cut 15%.
              </p>
              <p className="font-medium">Your call</p>
              <p className="text-muted-foreground">
                Open a product to tag it (discontinue, hold, competitor, seasonal, push), adjust its demand by a % or add
                a note. Discontinue and hold stop reorders; the demand % feeds straight into the reorder maths. Scores
                are saved every week so you can see each product rise or fall.
              </p>
              {isChina && (
                <p className="text-muted-foreground">
                  Weight and CBM per CTN come from buying entries; products without them use the values you enter on the
                  product (marked <span className="rounded bg-muted px-1 text-[9px] uppercase">man</span>).
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Reorder now</p>
            <p className="text-xl font-semibold tabular-nums">{counts.reorder}</p>
            <p className="text-[11px] text-muted-foreground">{totals.toOrder} need ordering in the next 15 days</p>
          </CardContent>
        </Card>
        {isChina && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Space for suggested orders</p>
              <p className="text-xl font-semibold tabular-nums">{num(totals.cbm, 1)} CBM</p>
              <p className="text-[11px] text-muted-foreground">
                {totals.missingCbm > 0 ? `${totals.missingCbm} items missing CBM` : '≈ ' + num(totals.cbm / 68, 1) + ' × 40ft HC'}
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Money stuck in dead stock</p>
            <p className="text-xl font-semibold"><AmountDisplay amount={totals.deadValue} decimals={0} /></p>
            <p className="text-[11px] text-muted-foreground">{counts.dead} products with no sale in 90+ days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Competitor pressure</p>
            <p className="text-xl font-semibold tabular-nums">{counts.pressure}</p>
            <p className="text-[11px] text-muted-foreground">price, margin or volume sliding</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['star', `${LABELS.star.icon} ${LABELS.star.text}`],
            ['good', `${LABELS.good.icon} ${LABELS.good.text}`],
            ['watch', `${LABELS.watch.icon} ${LABELS.watch.text}`],
            ['bad', `${LABELS.bad.icon} ${LABELS.bad.text}`],
            ['dead', `${LABELS.dead.icon} ${LABELS.dead.text}`],
            ['new', `${LABELS.new.icon} ${LABELS.new.text}`],
            ['reorder', '🛒 Reorder now'],
            ['pressure', '🥊 Competitor pressure'],
            ['tagged', '📝 Your tags'],
          ] as [Filter, string][]
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs transition-colors',
              filter === id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {text}
            <span className={cn('ml-1 inline-flex rounded-full px-1.5 text-[10px]', filter === id ? 'bg-white/20' : 'bg-background/60')}>
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 items-center gap-1 rounded-md bg-muted p-1">
          {(
            [
              ['table', 'Table'],
              ['matrix', 'A-B-C × X-Y-Z'],
              ...(isChina ? [['planner', 'Container planner']] : []),
            ] as [View, string][]
          ).map(([v, text]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn('h-7 rounded-sm px-3 text-xs', view === v ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {text}
            </button>
          ))}
        </div>
        {matrix && view === 'table' && (
          <button
            type="button"
            onClick={() => setMatrix(null)}
            className="rounded-full bg-foreground px-3 py-1 text-xs text-background"
          >
            Group {matrix.abc}{matrix.xyz === '-' ? ' (little history)' : matrix.xyz} ✕
          </button>
        )}
      </div>

      {view === 'matrix' && data && (
        <AbcXyzGrid
          products={products}
          onPick={(abc, xyz) => {
            setMatrix({ abc, xyz })
            setFilter('all')
            setView('table')
          }}
        />
      )}
      {view === 'planner' && data && isChina && <ContainerPlanner products={products} />}

      {/* Table */}
      {view !== 'table' ? null : loading && !data ? (
        <TableSkeleton rows={10} columns={8} />
      ) : (
        <div className={cn('overflow-x-auto rounded-md border', loading && 'opacity-60')}>
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="border-b text-xs">
                <th className="w-6 p-2" />
                <SortHead k="name" className="text-left">Product</SortHead>
                <SortHead k="score" className="text-left">Health</SortHead>
                <th className="p-2 text-left font-medium whitespace-nowrap">12 weeks</th>
                <SortHead k="sold30" className="text-right">30d CTN</SortHead>
                <SortHead k="trendPct" className="text-right">Trend</SortHead>
                <SortHead k="profitPerCtn" className="text-right">Profit / CTN</SortHead>
                {isChina && <SortHead k="profitPerCbm" className="text-right">Profit / CBM</SortHead>}
                <SortHead k="marginPct" className="text-right">Margin</SortHead>
                <SortHead k="stockReturn" className="text-right">Return on stock</SortHead>
                {isChina && <SortHead k="kgPerCbm" className="text-right">Kg/CTN · kg/CBM</SortHead>}
                <SortHead k="availableCtn" className="text-right">Stock</SortHead>
                <SortHead k="daysOfCover" className="text-right">Days left</SortHead>
                <SortHead k="suggestMax" className="text-right">Buy (CTN)</SortHead>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colCount + 1} className="p-8 text-center text-muted-foreground">
                    No products match.
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const L = LABELS[p.label]
                const open = expanded === p.id
                return (
                  <Fragment key={p.id}>
                    <tr
                      className={cn('cursor-pointer border-b transition-colors hover:bg-muted/40', open && 'bg-muted/40')}
                      onClick={() => setExpanded(open ? null : p.id)}
                    >
                      <td className="p-2 text-muted-foreground">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="max-w-[220px] p-2">
                        <Link
                          href={detailHref(p.id)}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.name}
                        </Link>
                        <div className="mt-0.5 flex gap-1 text-[10px] text-muted-foreground">
                          <span className="rounded border px-1" title="Profit contribution class">{p.abc}</span>
                          {p.xyz && <span className="rounded border px-1" title="Demand steadiness">{p.xyz}</span>}
                          {p.competitorPressure && <span title="Competitor pressure signals">🥊</span>}
                          {p.priceCutNoLift && <span title="Rate cut but sales didn't pick up">📉</span>}
                          {p.override && <span title={`Your tag: ${p.override.tag}${p.override.note ? ` — ${p.override.note}` : ''}`}>📝</span>}
                        </div>
                      </td>
                      <td className="p-2">
                        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', L.className)} title={L.hint}>
                          {L.icon} {L.text}
                          {p.score != null && <span className="tabular-nums opacity-80">· {p.score}</span>}
                        </span>
                        {p.scoreChange != null && p.scoreChange !== 0 && (
                          <span
                            className={cn('ml-1 text-[10px] tabular-nums', p.scoreChange > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}
                            title={`Score change since week of ${p.scoreChangeSince}`}
                          >
                            {p.scoreChange > 0 ? '▲' : '▼'}{Math.abs(p.scoreChange)}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <Sparkline values={p.weekly} titles={weeklyTitles(p.weekly)} ariaLabel={`Weekly CTN sold, last 12 weeks: ${p.weekly.join(', ')}`} />
                      </td>
                      <td className="p-2 text-right tabular-nums">{num(p.sold30, 1)}</td>
                      <td className="p-2 text-right"><TrendCell p={p} /></td>
                      <td className="p-2 text-right tabular-nums">{p.profitPerCtn == null ? '—' : <AmountDisplay amount={p.profitPerCtn} decimals={0} />}</td>
                      {isChina && (
                        <td className="p-2 text-right tabular-nums">
                          {p.profitPerCbm == null ? '—' : <AmountDisplay amount={p.profitPerCbm} decimals={0} />}
                          {p.profitPerCbm != null && <SourceTag source={p.cbmSource} />}
                        </td>
                      )}
                      <td className="p-2 text-right tabular-nums">
                        {p.marginPct == null ? '—' : `${p.marginPct.toFixed(1)}%`}
                        {p.marginDeltaPp != null && Math.abs(p.marginDeltaPp) >= 1 && (
                          <span className={cn('block text-[10px]', p.marginDeltaPp > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
                            {p.marginDeltaPp > 0 ? '+' : ''}{p.marginDeltaPp.toFixed(1)} pts
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'p-2 text-right tabular-nums',
                          p.stockReturn != null && p.stockReturn < 0.5 && 'text-red-700 dark:text-red-400'
                        )}
                        title="Yearly profit ÷ money in stock at cost"
                      >
                        {p.stockReturn == null ? '—' : `${p.stockReturn.toFixed(1)}×`}
                      </td>
                      {isChina && (
                        <td className="p-2 text-right tabular-nums whitespace-nowrap">
                          {num(p.weightPerCtn, 1)}
                          <SourceTag source={p.weightSource} />
                          <span className="text-muted-foreground"> · {num(p.kgPerCbm)}</span>
                        </td>
                      )}
                      <td className="p-2 text-right tabular-nums whitespace-nowrap">
                        {num(p.availableCtn, 1)}
                        {p.pipelineCtn > 0 && (
                          <span className="block text-[10px] text-blue-700 dark:text-blue-400" title="Factory + China WH + in transit">
                            +{num(p.pipelineCtn, 1)} coming
                          </span>
                        )}
                      </td>
                      <td className={cn('p-2 text-right tabular-nums', p.daysOfCover != null && data && p.daysOfCover < data.leadTimeDays && 'text-red-600 dark:text-red-400')}>
                        {num(p.daysOfCover)}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <span className="font-medium tabular-nums">
                          {p.suggestMax > 0 ? (p.suggestMin === p.suggestMax ? p.suggestMax : `${p.suggestMin}–${p.suggestMax}`) : '—'}
                        </span>
                        <span className={cn('block text-[10px]', REORDER[p.reorderStatus].className)}>
                          {REORDER[p.reorderStatus].text}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-muted/20">
                        <td />
                        <td colSpan={colCount} className="p-3">
                          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium">Why this score</p>
                              {p.score == null && <p className="text-xs text-muted-foreground">Not enough sales history to score yet.</p>}
                              {p.scoreParts.map((s) => (
                                <div key={s.key} className="flex items-center gap-2 text-xs">
                                  <span className="w-28 shrink-0 text-muted-foreground">{s.label} <span className="opacity-60">{s.weight}%</span></span>
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    {s.value != null && <div className="h-full rounded-full bg-foreground/60" style={{ width: `${s.value}%` }} />}
                                  </div>
                                  <span className="w-8 text-right tabular-nums">{s.value ?? '—'}</span>
                                </div>
                              ))}
                              {p.history.length > 1 && (
                                <div className="pt-2">
                                  <p className="text-xs font-medium">Score by week</p>
                                  <Sparkline
                                    values={p.history.map((h) => h.score)}
                                    titles={p.history.map((h) => `Week of ${h.week}: ${h.score ?? 'no score'} (${LABELS[h.label as InsightLabel]?.text ?? h.label})`)}
                                    max={100}
                                    width={180}
                                    height={36}
                                    ariaLabel={`Weekly health score: ${p.history.map((h) => h.score ?? '—').join(', ')}`}
                                  />
                                </div>
                              )}
                              {p.history.length <= 1 && (
                                <p className="pt-2 text-[10px] text-muted-foreground">Score history builds up week by week from now.</p>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium">Signals</p>
                              {p.signals.length === 0 && <p className="text-xs text-muted-foreground">Nothing unusual.</p>}
                              {p.signals.map((s, i) => (
                                <p key={i} className={cn('flex gap-1.5 text-xs', SIGNAL_TONE[s.tone].className)}>
                                  <span className="w-3 shrink-0 text-center font-bold">{SIGNAL_TONE[s.tone].icon}</span>
                                  <span>{s.text}</span>
                                </p>
                              ))}
                              {p.lostCustomers.length > 0 && (
                                <div className="pt-2">
                                  <p className="text-xs font-medium">Stopped buying</p>
                                  <ul className="mt-1 space-y-0.5 text-xs">
                                    {p.lostCustomers.slice(0, 6).map((c) => (
                                      <li key={c.name} className="flex justify-between gap-2">
                                        <span className="truncate">{c.name}</span>
                                        <span className="shrink-0 tabular-nums text-muted-foreground">
                                          {c.bills} bills · {c.ctn} CTN · {c.lastSaleDaysAgo}d ago
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                              <dt className="text-muted-foreground">Sold 90 / 180 days</dt>
                              <dd className="tabular-nums">{num(p.sold90, 1)} / {num(p.sold180, 1)} CTN</dd>
                              <dt className="text-muted-foreground">Daily demand</dt>
                              <dd className="tabular-nums">{num(p.dailyDemand, 2)} CTN</dd>
                              <dt className="text-muted-foreground">Bills (90d) · customers (180d)</dt>
                              <dd className="tabular-nums">{p.bills90} · {p.customers180}</dd>
                              <dt className="text-muted-foreground">Last sale</dt>
                              <dd>{p.daysSinceLastSale == null ? 'Not in 180 days' : `${p.daysSinceLastSale} days ago`}</dd>
                              <dt className="text-muted-foreground">Profit (90d)</dt>
                              <dd><AmountDisplay amount={p.profit90} decimals={0} /></dd>
                              <dt className="text-muted-foreground">Selling rate change</dt>
                              <dd className="tabular-nums">{p.priceChangePct == null ? '—' : `${p.priceChangePct > 0 ? '+' : ''}${p.priceChangePct}%`}</dd>
                              <dt className="text-muted-foreground">Landed cost change</dt>
                              <dd className="tabular-nums">{p.costChangePct == null ? '—' : `${p.costChangePct > 0 ? '+' : ''}${p.costChangePct}%`}</dd>
                              <dt className="text-muted-foreground">Stock value · oldest</dt>
                              <dd className="tabular-nums"><AmountDisplay amount={p.stockValue} decimals={0} /> · {p.oldestStockDays == null ? '—' : `${p.oldestStockDays}d`}</dd>
                              {isChina && (
                                <>
                                  <dt className="text-muted-foreground">CBM / CTN · pcs / CTN</dt>
                                  <dd className="tabular-nums">{num(p.cbmPerCtn, 4)}<SourceTag source={p.cbmSource} /> · {num(p.qtyPerCtn)}</dd>
                                </>
                              )}
                              <dt className="text-muted-foreground">Reorder point · confidence</dt>
                              <dd className="tabular-nums">{p.reorderPoint} CTN · {p.confidence}</dd>
                            </dl>
                            <OverrideEditor key={`${p.id}:${p.override?.updatedAt ?? ''}`} p={p} source={source} onSaved={load} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
