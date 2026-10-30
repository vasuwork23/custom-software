'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/NumberInput'
import { cn } from '@/lib/utils'
import {
  cbmBreakdownError as breakdownError,
  summarizeCbmBreakdown,
  type CbmBreakdownRow,
} from '@/lib/cbm-breakdown'

export interface CbmSizeRow {
  ctn?: number
  cbm?: number
}

export function toBreakdownRows(rows: CbmSizeRow[]): CbmBreakdownRow[] {
  return rows.map((r) => ({ ctn: r.ctn ?? 0, cbm: r.cbm ?? 0 }))
}

/** Error message unless the sizes add up to the India CTN. */
export function cbmBreakdownError(rows: CbmSizeRow[], indiaCtn: number): string | null {
  return breakdownError(toBreakdownRows(rows), indiaCtn)
}

interface CbmBreakdownEditorProps {
  /** CTN in India (available + sold) — the sizes must add up to this */
  indiaCtn: number
  rows: CbmSizeRow[]
  onChange: (rows: CbmSizeRow[]) => void
}

export function CbmBreakdownEditor({ indiaCtn, rows, onChange }: CbmBreakdownEditorProps) {
  const summary = summarizeCbmBreakdown(toBreakdownRows(rows))
  const ctnLeft = parseFloat((indiaCtn - summary.totalCtn).toFixed(4))
  const error = cbmBreakdownError(rows, indiaCtn)

  const updateRow = (i: number, patch: CbmSizeRow) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
        <span>CTN</span>
        <span>CBM per CTN</span>
        <span className="text-right">Total CBM</span>
        <span className="w-8" />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <NumberInput
            aria-label={`Carton size ${i + 1} CTN`}
            placeholder="CTN"
            value={row.ctn}
            onChange={(v) => updateRow(i, { ctn: v })}
          />
          <NumberInput
            aria-label={`Carton size ${i + 1} CBM per CTN`}
            placeholder="CBM"
            value={row.cbm}
            onChange={(v) => updateRow(i, { cbm: v })}
          />
          <span className="text-right text-sm tabular-nums">
            {parseFloat(((row.ctn ?? 0) * (row.cbm ?? 0)).toFixed(5))}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={rows.length <= 1}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label="Remove carton size"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { ctn: ctnLeft > 0 ? ctnLeft : undefined, cbm: undefined }])}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Add carton size
      </Button>

      <div
        className={cn(
          'text-xs px-2 py-1 rounded',
          error
            ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
            : 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
        )}
      >
        {rows.map((r) => r.ctn ?? 0).join(' + ')} = {parseFloat(summary.totalCtn.toFixed(4))} / {indiaCtn} CTN in India
        {error ? ` ⚠️ ${error}` : ' ✅'}
      </div>

      <div className="grid grid-cols-2 gap-y-1 text-sm max-w-md">
        <span className="text-muted-foreground">Total CBM ({indiaCtn} CTN)</span>
        <span className="text-right font-medium">{parseFloat(summary.totalCbm.toFixed(5))}</span>
        <span className="text-muted-foreground">Avg CBM per CTN</span>
        <span className="text-right font-semibold text-blue-600 dark:text-blue-400">
          {error ? '—' : parseFloat(summary.avgCbm.toFixed(5))}
        </span>
      </div>
    </div>
  )
}
