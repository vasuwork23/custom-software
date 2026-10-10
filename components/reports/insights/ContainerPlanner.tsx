'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import type { InsightRow } from './types'
import { num, REORDER } from './types'

const CONTAINERS = {
  '20GP': { label: "20' GP", cbm: 28, kg: 21000 },
  '40GP': { label: "40' GP", cbm: 58, kg: 26000 },
  '40HC': { label: "40' HC", cbm: 68, kg: 26000 },
} as const
type ContainerType = keyof typeof CONTAINERS

type Why = 'reorder' | 'soon' | 'top-up'

interface PlanLine {
  p: InsightRow
  why: Why
  wanted: number
  ctn: number // what fits
}

const WHY_TEXT: Record<Why, string> = { reorder: 'Reorder now', soon: 'Order soon', 'top-up': 'Top-up' }

/**
 * Fill one container: urgent reorders first, then "order soon", then optional
 * top-up with healthy sellers — each group in order of profit per CBM, stopping at
 * whichever runs out first, space or weight.
 */
function buildPlan(products: InsightRow[], cap: { cbm: number; kg: number }, includeSoon: boolean, topUp: boolean) {
  const byProfitPerCbm = (a: InsightRow, b: InsightRow) => (b.profitPerCbm ?? -Infinity) - (a.profitPerCbm ?? -Infinity)
  const blocked = (p: InsightRow) => p.override?.tag === 'discontinue' || p.override?.tag === 'hold'
  const mid = (p: InsightRow) => Math.round((p.suggestMin + p.suggestMax) / 2)

  const usable = products.filter((p) => p.cbmPerCtn && !blocked(p))
  const missingCbm = products.filter(
    (p) => !p.cbmPerCtn && !blocked(p) && p.suggestMax > 0 && (p.reorderStatus === 'now' || p.reorderStatus === 'soon')
  )

  const groups: [Why, InsightRow[], (p: InsightRow) => number][] = [
    ['reorder', usable.filter((p) => p.reorderStatus === 'now' && p.suggestMax > 0).sort(byProfitPerCbm), mid],
    ['soon', includeSoon ? usable.filter((p) => p.reorderStatus === 'soon' && p.suggestMax > 0).sort(byProfitPerCbm) : [], mid],
    [
      'top-up',
      topUp
        ? usable
            .filter(
              (p) =>
                (p.label === 'star' || p.label === 'good') &&
                p.abc !== 'C' &&
                !p.competitorPressure &&
                p.dailyDemand > 0 &&
                p.reorderStatus !== 'overstock'
            )
            .sort(byProfitPerCbm)
        : [],
      // ~30 more days of selling on top of anything already planned
      (p) => Math.max(1, Math.round(p.dailyDemand * 30)),
    ],
  ]

  let cbmLeft = cap.cbm
  let kgLeft = cap.kg
  const lines: PlanLine[] = []
  const planned = new Set<string>()
  for (const [why, list, qty] of groups) {
    for (const p of list) {
      if (why === 'top-up' && planned.has(p.id)) continue
      const wanted = qty(p)
      if (wanted <= 0) continue
      const byCbm = Math.floor(cbmLeft / (p.cbmPerCtn as number))
      const byKg = p.weightPerCtn ? Math.floor(kgLeft / p.weightPerCtn) : Infinity
      const ctn = Math.max(0, Math.min(wanted, byCbm, byKg))
      lines.push({ p, why, wanted, ctn })
      planned.add(p.id)
      cbmLeft -= ctn * (p.cbmPerCtn as number)
      kgLeft -= ctn * (p.weightPerCtn ?? 0)
    }
  }
  return { lines, missingCbm }
}

function Meter({ label, used, cap, unit }: { label: string; used: number; cap: number; unit: string }) {
  const pct = cap > 0 ? (used / cap) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('tabular-nums', pct > 100 && 'font-medium text-red-600 dark:text-red-400')}>
          {num(used, 2)} / {num(cap)} {unit} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', pct > 100 ? 'bg-red-500' : pct > 90 ? 'bg-emerald-600' : 'bg-foreground/60')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}

export function ContainerPlanner({ products }: { products: InsightRow[] }) {
  const [type, setType] = useState<ContainerType>('40HC')
  const [capCbm, setCapCbm] = useState<string>(String(CONTAINERS['40HC'].cbm))
  const [capKg, setCapKg] = useState<string>(String(CONTAINERS['40HC'].kg))
  const [includeSoon, setIncludeSoon] = useState(true)
  const [topUp, setTopUp] = useState(true)
  const [edits, setEdits] = useState<Record<string, number>>({})

  const cap = { cbm: Number(capCbm) || 0, kg: Number(capKg) || 0 }
  const plan = useMemo(() => buildPlan(products, cap, includeSoon, topUp), [products, cap.cbm, cap.kg, includeSoon, topUp]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines = plan.lines.map((l) => ({ ...l, final: edits[l.p.id] ?? l.ctn }))
  const totals = lines.reduce(
    (a, l) => ({
      ctn: a.ctn + l.final,
      cbm: a.cbm + l.final * (l.p.cbmPerCtn ?? 0),
      kg: a.kg + l.final * (l.p.weightPerCtn ?? 0),
      profit: a.profit + l.final * (l.p.profitPerCtn ?? 0),
      noWeight: a.noWeight + (l.final > 0 && !l.p.weightPerCtn ? 1 : 0),
    }),
    { ctn: 0, cbm: 0, kg: 0, profit: 0, noWeight: 0 }
  )

  const pickType = (t: ContainerType) => {
    setType(t)
    setCapCbm(String(CONTAINERS[t].cbm))
    setCapKg(String(CONTAINERS[t].kg))
    setEdits({})
  }

  const copyList = async () => {
    const text = lines
      .filter((l) => l.final > 0)
      .map((l) => `${l.p.name} — ${l.final} CTN`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(`${CONTAINERS[type].label} plan\n${text}\nTotal ${totals.ctn} CTN · ${totals.cbm.toFixed(2)} CBM · ${Math.round(totals.kg)} kg`)
      toast.success('Order list copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex h-10 items-center gap-1 rounded-md bg-muted p-1">
          {(Object.keys(CONTAINERS) as ContainerType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickType(t)}
              className={cn('h-8 rounded-sm px-3 text-sm', type === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {CONTAINERS[t].label}
            </button>
          ))}
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Usable CBM</span>
          <Input type="number" className="h-10 w-24" value={capCbm} onChange={(e) => setCapCbm(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Max weight (kg)</span>
          <Input type="number" className="h-10 w-28" value={capKg} onChange={(e) => setCapKg(e.target.value)} />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={includeSoon} onChange={(e) => { setIncludeSoon(e.target.checked); setEdits({}) }} />
          Include &ldquo;order soon&rdquo;
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={topUp} onChange={(e) => { setTopUp(e.target.checked); setEdits({}) }} />
          Fill spare space with best sellers
        </label>
        <Button variant="outline" size="sm" className="h-10 sm:ml-auto" onClick={copyList} disabled={totals.ctn === 0}>
          Copy order list
        </Button>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-3">
        <Meter label="Space" used={totals.cbm} cap={cap.cbm} unit="CBM" />
        <Meter label="Weight" used={totals.kg} cap={cap.kg} unit="kg" />
        <div className="space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Cartons</span><span className="tabular-nums">{num(totals.ctn)}</span></div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expected profit (at today&apos;s profit/CTN)</span>
            <AmountDisplay amount={totals.profit} decimals={0} />
          </div>
          {totals.cbm > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Profit per CBM loaded</span>
              <AmountDisplay amount={totals.profit / totals.cbm} decimals={0} />
            </div>
          )}
          {totals.noWeight > 0 && <p className="text-amber-700 dark:text-amber-400">{totals.noWeight} lines have no weight — weight total is low.</p>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="p-2 text-left font-medium">Product</th>
              <th className="p-2 text-left font-medium">Why</th>
              <th className="p-2 text-right font-medium">Profit / CBM</th>
              <th className="p-2 text-right font-medium">CBM · kg per CTN</th>
              <th className="p-2 text-right font-medium">Suggested</th>
              <th className="p-2 text-right font-medium">Load CTN</th>
              <th className="p-2 text-right font-medium">CBM</th>
              <th className="p-2 text-right font-medium">kg</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Nothing needs ordering right now.</td></tr>
            )}
            {lines.map((l) => (
              <tr key={l.p.id} className={cn('border-b', l.final === 0 && 'text-muted-foreground')}>
                <td className="p-2">
                  <Link href={`/products/${l.p.id}`} className="font-medium hover:underline">{l.p.name}</Link>
                  <span className="ml-1 text-[10px] text-muted-foreground">{l.p.abc}{l.p.xyz ?? ''}</span>
                </td>
                <td className={cn('p-2 text-xs', l.why === 'reorder' ? REORDER.now.className : l.why === 'soon' ? REORDER.soon.className : 'text-muted-foreground')}>
                  {WHY_TEXT[l.why]}
                </td>
                <td className="p-2 text-right tabular-nums">{l.p.profitPerCbm == null ? '—' : <AmountDisplay amount={l.p.profitPerCbm} decimals={0} />}</td>
                <td className="p-2 text-right tabular-nums">{num(l.p.cbmPerCtn, 4)} · {num(l.p.weightPerCtn, 1)}</td>
                <td className="p-2 text-right tabular-nums">
                  {l.wanted}
                  {l.ctn < l.wanted && <span className="block text-[10px] text-amber-700 dark:text-amber-400">only {l.ctn} fit</span>}
                </td>
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    min={0}
                    className="ml-auto h-8 w-20 text-right"
                    value={l.final}
                    onChange={(e) => setEdits((m) => ({ ...m, [l.p.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                  />
                </td>
                <td className="p-2 text-right tabular-nums">{num(l.final * (l.p.cbmPerCtn ?? 0), 2)}</td>
                <td className="p-2 text-right tabular-nums">{num(l.final * (l.p.weightPerCtn ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.missingCbm.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Need ordering but no CBM per CTN, so not planned: {plan.missingCbm.map((p) => p.name).join(', ')}. Add CBM on the product to include them.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Urgent items load first, then &ldquo;order soon&rdquo;, then best sellers; within each group the highest profit per CBM goes first.
        Products you marked discontinue or on hold are left out. Edit any quantity — totals update.
      </p>
    </div>
  )
}
