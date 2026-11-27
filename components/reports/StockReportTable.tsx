'use client'

import { cn } from '@/lib/utils'
import {
  STOCK_COLUMNS,
  formatStockCell,
  stockTotals,
  type StockColumnKey,
  type StockReportRow,
} from '@/lib/stock-report-columns'

const CELL_TONE: Partial<Record<StockColumnKey, string>> = {
  avgCost: 'text-emerald-600',
  avgSell: 'text-blue-600',
}

function profitTone(v: unknown) {
  if (typeof v !== 'number') return ''
  return v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'
}

export function StockReportTable({ rows, emptyText }: { rows: StockReportRow[]; emptyText?: string }) {
  if (rows.length === 0 && emptyText) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  const totals = stockTotals(rows)
  return (
    <div className="rounded-md border overflow-x-auto max-h-[550px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b bg-muted/80">
            {STOCK_COLUMNS.map((c) => (
              <th key={c.key} className={cn('p-3 font-medium whitespace-nowrap',c.align === 'left' ? 'text-left' : 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b hover:bg-muted/30">
              {STOCK_COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'p-3',
                    c.align === 'right' && 'text-right',
                    CELL_TONE[c.key],
                    c.key === 'profitPct' && profitTone(r.profitPct)
                  )}
                >
                  {formatStockCell(c.key, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t-2 bg-muted/80 font-semibold">
              {STOCK_COLUMNS.map((c) => (
                <td key={c.key} className={cn('p-3', c.align === 'right' && 'text-right')}>
                  {formatStockCell(c.key, totals[c.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
