'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const STORAGE_PREFIX = 'export-columns:'

/**
 * Asks which columns go into a PDF / Excel download. The last choice is
 * remembered per `storageKey` so the next download starts from it.
 */
export function ExportColumnsDialog<K extends string>({
  open,
  onOpenChange,
  formatLabel,
  columns,
  storageKey,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  formatLabel: string
  columns: { key: K; label: string }[]
  storageKey: string
  onConfirm: (keys: K[]) => void
}) {
  const allKeys = columns.map((c) => c.key)
  const [selected, setSelected] = useState<K[]>(allKeys)

  // Load the remembered choice each time the dialog opens.
  useEffect(() => {
    if (!open) return
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + storageKey) ?? 'null') as string[] | null
      const valid = saved?.filter((k): k is K => (allKeys as string[]).includes(k))
      setSelected(valid?.length ? valid : allKeys)
    } catch {
      setSelected(allKeys)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey])

  const toggle = (key: K) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const allOn = selected.length === allKeys.length

  const confirm = () => {
    // Keep the table's column order regardless of click order.
    const ordered = allKeys.filter((k) => selected.includes(k))
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(ordered))
    } catch {
      // storage full or blocked — the download still goes ahead
    }
    onOpenChange(false)
    onConfirm(ordered)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Download {formatLabel}</DialogTitle>
          <DialogDescription>Choose the columns to include.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b pb-2">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allOn}
              onChange={() => setSelected(allOn ? [] : allKeys)}
            />
            Select all
          </label>
          <span className="text-xs text-muted-foreground">
            {selected.length} of {allKeys.length}
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-1 hover:bg-muted/50">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selected.includes(c.key)}
                onChange={() => toggle(c.key)}
              />
              {c.label}
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={selected.length === 0}>
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
