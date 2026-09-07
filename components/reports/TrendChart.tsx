'use client'

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
} from 'recharts'
import { cn } from '@/lib/utils'

export interface TrendRow {
  period: string
  /** First and last day the bucket covers, as YYYY-MM-DD. */
  start: string
  end: string
  revenue: number
  cost: number
  grossProfit: number
  netProfit: number
  /** Axis tick, e.g. '5 Sep'. */
  label: string
  /** Full range for the tooltip heading, e.g. 'Monday, 5 Sep 2026'. */
  rangeLabel: string
  /** Gross or net, whichever the P&L toggle is showing. */
  profit: number
  /** False for a single-day bucket — there is nothing finer to drill into. */
  canDrill: boolean
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

function TrendTooltip({
  active,
  payload,
  profitLabel,
}: {
  active?: boolean
  payload?: { payload: TrendRow }[]
  profitLabel: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{row.rangeLabel}</p>
      <div className="space-y-0.5">
        <p className="flex justify-between gap-6">
          <span className="text-muted-foreground">Revenue</span>
          <span className="tabular-nums">{inr(row.revenue)}</span>
        </p>
        <p className="flex justify-between gap-6">
          <span className="text-muted-foreground">Cost</span>
          <span className="tabular-nums">{inr(row.cost)}</span>
        </p>
        <p className="flex justify-between gap-6 border-t pt-0.5 font-medium">
          <span className="text-muted-foreground">{profitLabel}</span>
          <span className={cn('tabular-nums', row.profit < 0 && 'text-destructive')}>
            {inr(row.profit)}
          </span>
        </p>
      </div>
    </div>
  )
}

/**
 * Revenue bars with the profit line over them, both on the one rupee axis — the
 * pair only reads as a comparison because they share a scale, so never split them
 * onto two.
 */
export function TrendChart({
  data,
  profitLabel,
  onDrill,
  size,
}: {
  data: TrendRow[]
  profitLabel: string
  onDrill?: (row: TrendRow) => void
  /** Fixed dimensions in place of ResponsiveContainer, for static rendering. */
  size?: { width: number; height: number }
}) {
  const hasNegativeProfit = data.some((r) => r.profit < 0)
  const isStatic = size != null
  // Thin the ticks ourselves rather than leaving it to Recharts' text measurement,
  // which needs a laid-out DOM and lets 30 day-labels pile onto each other.
  const tickInterval = Math.max(0, Math.ceil(data.length / 12) - 1)

  const chart = (
    <ComposedChart {...size} data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        axisLine={false}
        tickLine={false}
        interval={tickInterval}
        minTickGap={8}
        height={22}
      />
      <YAxis
        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        axisLine={false}
        tickLine={false}
        width={56}
      />
      <Tooltip
        cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }}
        content={<TrendTooltip profitLabel={profitLabel} />}
      />
      {hasNegativeProfit && <ReferenceLine y={0} stroke="hsl(var(--border))" />}
      <Bar
        dataKey="revenue"
        name="Revenue"
        fill="var(--trend-revenue)"
        radius={[4, 4, 0, 0]}
        maxBarSize={28}
        cursor={onDrill ? 'pointer' : undefined}
        isAnimationActive={!isStatic}
        onClick={
          onDrill
            ? (entry: unknown) => {
                // Recharts hands the bar's own props, which carry the row either
                // spread at the top level or nested under `payload`.
                const hit = entry as (TrendRow & { payload?: TrendRow }) | null
                const row = hit?.payload ?? hit
                if (row?.start) onDrill(row)
              }
            : undefined
        }
      />
      <Line
        type="monotone"
        dataKey="profit"
        name={profitLabel}
        stroke="var(--trend-profit)"
        strokeWidth={2}
        dot={data.length > 14 ? false : { r: 4 }}
        activeDot={{ r: 5 }}
        isAnimationActive={!isStatic}
      />
    </ComposedChart>
  )

  // Our own legend rather than Recharts', which is laid out from measured text and
  // ends up drawn over the tallest bar.
  const legend = (
    <div className="mb-1 flex items-center justify-end gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--trend-revenue)' }} />
        Revenue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 rounded-full" style={{ background: 'var(--trend-profit)' }} />
        {profitLabel}
      </span>
    </div>
  )

  if (isStatic) {
    return (
      <div style={{ width: size.width }}>
        {legend}
        {chart}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      {legend}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
