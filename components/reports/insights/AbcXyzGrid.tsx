'use client'

import { cn } from '@/lib/utils'
import type { InsightRow } from './types'
import { num } from './types'

type Abc = 'A' | 'B' | 'C'
type Xyz = 'X' | 'Y' | 'Z' | '-'

const ACTION: Record<Abc, Record<Xyz, string>> = {
  A: {
    X: 'Never run out. Reorder on time, keep safety stock.',
    Y: 'Keep stocked; review every 2 weeks.',
    Z: 'Big earner but jumpy — order smaller batches more often.',
    '-': 'Earns well; too little history to judge steadiness.',
  },
  B: {
    X: 'Steady — automate reorders by the suggestion.',
    Y: 'Normal reorder; watch the trend.',
    Z: 'Order only against real demand.',
    '-': 'Watch a few more weeks.',
  },
  C: {
    X: 'Small but steady — keep low stock.',
    Y: 'Low priority; don’t overbuy.',
    Z: 'Stop buying; clear what’s left.',
    '-': 'Little profit and little data — don’t reorder yet.',
  },
}

const TONE: Record<Abc, Record<Xyz, string>> = {
  A: { X: 'border-emerald-300 dark:border-emerald-800', Y: 'border-emerald-300 dark:border-emerald-800', Z: 'border-amber-300 dark:border-amber-800', '-': '' },
  B: { X: 'border-emerald-300 dark:border-emerald-800', Y: '', Z: 'border-amber-300 dark:border-amber-800', '-': '' },
  C: { X: '', Y: 'border-amber-300 dark:border-amber-800', Z: 'border-red-300 dark:border-red-800', '-': '' },
}

export function AbcXyzGrid({
  products,
  onPick,
}: {
  products: InsightRow[]
  onPick: (abc: Abc, xyz: Xyz) => void
}) {
  const cell = (abc: Abc, xyz: Xyz) => {
    const list = products.filter((p) => p.abc === abc && (p.xyz ?? '-') === xyz)
    const profit = list.reduce((a, p) => a + p.profit180, 0)
    const stock = list.reduce((a, p) => a + p.stockValue, 0)
    return { count: list.length, profit, stock }
  }
  const cols: Xyz[] = ['X', 'Y', 'Z', '-']
  const colHead: Record<Xyz, string> = { X: 'X · steady', Y: 'Y · up & down', Z: 'Z · unpredictable', '-': 'Too little history' }
  const rowHead: Record<Abc, string> = { A: 'A · top 80% of profit', B: 'B · next 15%', C: 'C · last 5% / none' }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-[150px_repeat(4,1fr)] gap-2">
        <div />
        {cols.map((c) => (
          <div key={c} className="px-2 text-xs font-medium text-muted-foreground">{colHead[c]}</div>
        ))}
        {(['A', 'B', 'C'] as Abc[]).map((abc) => (
          <div key={abc} className="contents">
            <div className="flex items-center px-2 text-xs font-medium text-muted-foreground">{rowHead[abc]}</div>
            {cols.map((xyz) => {
              const c = cell(abc, xyz)
              return (
                <button
                  key={xyz}
                  type="button"
                  disabled={c.count === 0}
                  onClick={() => onPick(abc, xyz)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
                    TONE[abc][xyz]
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{abc}{xyz === '-' ? '' : xyz}</span>
                    <span className="text-lg font-semibold tabular-nums">{c.count}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{ACTION[abc][xyz]}</p>
                  {c.count > 0 && (
                    <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                      Profit 180d ₹{num(c.profit)} · stock ₹{num(c.stock)}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Click a box to list those products in the table.</p>
    </div>
  )
}
