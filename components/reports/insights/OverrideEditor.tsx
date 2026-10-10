'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { apiPut } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OverrideTag } from '@/lib/product-insights'
import type { InsightRow, Source } from './types'

const TAG_TEXT: Record<OverrideTag, string> = {
  none: 'No tag',
  discontinue: 'Discontinue (no reorder)',
  hold: 'Hold (pause reorder)',
  competitor: 'Competitor dumping price',
  seasonal: 'Seasonal',
  push: 'Push / promote',
}

/** Your own call on a product; saving it re-runs the insights. */
export function OverrideEditor({ p, source, onSaved }: { p: InsightRow; source: Source; onSaved: () => void }) {
  const [tag, setTag] = useState<OverrideTag>(p.override?.tag ?? 'none')
  const [adjust, setAdjust] = useState(String(p.override?.demandAdjustPct ?? 0))
  const [note, setNote] = useState(p.override?.note ?? '')
  const [saving, setSaving] = useState(false)

  const save = async (clear = false) => {
    setSaving(true)
    const res = await apiPut('/api/reports/insights/override', {
      source,
      productId: p.id,
      tag: clear ? 'none' : tag,
      demandAdjustPct: clear ? 0 : Number(adjust) || 0,
      note: clear ? '' : note,
    })
    setSaving(false)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    if (clear) {
      setTag('none')
      setAdjust('0')
      setNote('')
    }
    toast.success(clear ? 'Back to data only' : 'Saved — suggestions updated')
    onSaved()
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-xs font-medium">Your call</p>
      <div className="flex flex-wrap gap-2">
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={tag}
          onChange={(e) => setTag(e.target.value as OverrideTag)}
        >
          {(Object.keys(TAG_TEXT) as OverrideTag[]).map((t) => (
            <option key={t} value={t}>{TAG_TEXT[t]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Demand
          <Input type="number" className="h-8 w-20 text-xs" value={adjust} onChange={(e) => setAdjust(e.target.value)} min={-100} max={300} />
          %
        </label>
      </div>
      <Input
        className="h-8 text-xs"
        placeholder="Note, e.g. competitor selling at ₹19 in Sadar"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {p.override && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={saving} onClick={() => save(true)}>
            Clear
          </Button>
        )}
      </div>
      {p.override?.updatedAt && (
        <p className="text-[10px] text-muted-foreground">
          Last set {format(new Date(p.override.updatedAt), 'd MMM yyyy')}
          {p.override.updatedByName ? ` by ${p.override.updatedByName}` : ''}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Demand % changes the reorder maths only (e.g. +40 before a festival, −50 if a competitor flooded the market).
      </p>
    </div>
  )
}
