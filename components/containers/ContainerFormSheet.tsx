'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiGet, apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const DATE_DISPLAY_FORMAT = 'dd/MM/yyyy'

interface AvailableEntry {
  _id: string
  productId: string
  productName: string
  mark: string
  entryDate: string
  inTransitCtn: number
  alreadyLoaded: number
  remainingCtn: number
  cbmPerCtn: number
  weightPerCtn: number
}

interface EntryRow {
  buyingEntryId: string
  productName: string
  mark: string
  inTransitCtn: number
  ctnCount: number
  cbm: number
  weight: number
  cbmPerCtn: number
  weightPerCtn: number
}

interface ContainerFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editContainer?: {
    _id: string
    containerId: string
    containerName: string
    remarks?: string
    status: string
    loadingDate?: string
    dispatchDate?: string
    estimatedArrival?: string
    arrivedDate?: string
    entries: { buyingEntry: string; productName?: string; mark?: string; ctnCount: number; cbm: number; weight?: number }[]
  } | null
}

function DatePickerField({
  value,
  onChange,
  label,
  error,
  id,
}: {
  value: Date | undefined
  onChange: (d: Date | undefined) => void
  label: string
  error?: string
  id?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(
              'w-full justify-start text-left font-normal',
              error && 'border-red-500'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, DATE_DISPLAY_FORMAT) : 'Pick a date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={(d) => onChange(d)} />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function ContainerFormSheet({
  open,
  onOpenChange,
  onSuccess,
  editContainer,
}: ContainerFormSheetProps) {
  const isEdit = !!editContainer
  const [containerId, setContainerId] = useState('')
  const [containerName, setContainerName] = useState('')
  const [remarks, setRemarks] = useState('')
  const [status, setStatus] = useState('loading')
  const [loadingDate, setLoadingDate] = useState<Date | undefined>(undefined)
  const [dispatchDate, setDispatchDate] = useState<Date | undefined>(undefined)
  const [estimatedArrival, setEstimatedArrival] = useState<Date | undefined>(undefined)
  const [arrivedDate, setArrivedDate] = useState<Date | undefined>(undefined)
  const [entryRows, setEntryRows] = useState<EntryRow[]>([])
  const [availableEntries, setAvailableEntries] = useState<AvailableEntry[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [addEntryId, setAddEntryId] = useState('')
  const [ctnToLoad, setCtnToLoad] = useState<number>(0)
  const [ctnError, setCtnError] = useState<string | null>(null)

  const [containerIdError, setContainerIdError] = useState<string | null>(null)
  const [containerNameError, setContainerNameError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [entriesError, setEntriesError] = useState<string | null>(null)

  const containerIdRef = useRef<HTMLInputElement>(null)
  const containerNameRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLSelectElement>(null)
  const entriesSectionRef = useRef<HTMLDivElement>(null)

  const loadAvailable = useCallback(async () => {
    setLoadingAvailable(true)
    const res = await apiGet<{ entries: AvailableEntry[] }>('/api/containers/available-entries')
    setLoadingAvailable(false)
    if (res.success && res.data?.entries) setAvailableEntries(res.data.entries)
    else {
      setAvailableEntries([])
      if (!res.success) toast.error(res.message)
    }
  }, [])

  useEffect(() => {
    if (open && !isEdit) loadAvailable()
  }, [open, isEdit, loadAvailable])

  useEffect(() => {
    if (open && isEdit && editContainer) {
      setContainerId(editContainer.containerId)
      setContainerName(editContainer.containerName)
      setRemarks(editContainer.remarks ?? '')
      setStatus(editContainer.status)
      setLoadingDate(editContainer.loadingDate ? new Date(editContainer.loadingDate) : undefined)
      setDispatchDate(editContainer.dispatchDate ? new Date(editContainer.dispatchDate) : undefined)
      setEstimatedArrival(editContainer.estimatedArrival ? new Date(editContainer.estimatedArrival) : undefined)
      setArrivedDate(editContainer.arrivedDate ? new Date(editContainer.arrivedDate) : undefined)
      setEntryRows(
        editContainer.entries.map((e) => ({
          buyingEntryId: typeof e.buyingEntry === 'object' ? (e.buyingEntry as { _id?: string })?._id ?? '' : String(e.buyingEntry),
          productName: e.productName ?? '—',
          mark: e.mark ?? '—',
          inTransitCtn: 0,
          ctnCount: e.ctnCount,
          cbm: e.cbm,
          weight: e.weight ?? 0,
          cbmPerCtn: e.cbm / e.ctnCount,
          weightPerCtn: (e.weight ?? 0) / e.ctnCount,
        }))
      )
    }
  }, [open, isEdit, editContainer])

  useEffect(() => {
    if (open && !isEdit) {
      setContainerId('')
      setContainerName('')
      setRemarks('')
      setStatus('loading')
      setLoadingDate(undefined)
      setDispatchDate(undefined)
      setEstimatedArrival(undefined)
      setArrivedDate(undefined)
      setEntryRows([])
      setAddEntryId('')
      setCtnToLoad(0)
      setCtnError(null)
      setContainerIdError(null)
      setContainerNameError(null)
      setStatusError(null)
      setEntriesError(null)
    }
  }, [open, isEdit])

  const selectedEntry = addEntryId ? availableEntries.find((e) => e._id === addEntryId) : null
  const alreadyAddedCtn = selectedEntry
    ? entryRows.filter((r) => r.buyingEntryId === selectedEntry._id).reduce((s, r) => s + r.ctnCount, 0)
    : 0
  const maxCtn = selectedEntry ? Math.max(0, selectedEntry.remainingCtn - alreadyAddedCtn) : 0

  useEffect(() => {
    if (!selectedEntry) {
      setCtnToLoad(0)
      setCtnError(null)
      return
    }
    if (ctnToLoad > maxCtn) {
      setCtnError(maxCtn > 0 ? `Cannot exceed ${maxCtn} CTN (${alreadyAddedCtn} already added)` : 'No CTN remaining for this entry')
    } else {
      setCtnError(null)
    }
  }, [selectedEntry, maxCtn, alreadyAddedCtn, ctnToLoad])

  const addEntry = () => {
    if (!selectedEntry) return
    if (ctnToLoad < 1 || ctnToLoad > maxCtn) {
      if (ctnToLoad < 1) setCtnError('⚠️ CTN must be greater than 0')
      else setCtnError(`⚠️ CTN cannot exceed ${maxCtn} (available in transit)`)
      return
    }
    setEntryRows((prev) => [
      ...prev,
      {
        buyingEntryId: selectedEntry._id,
        productName: selectedEntry.productName,
        mark: selectedEntry.mark,
        inTransitCtn: selectedEntry.inTransitCtn,
        ctnCount: ctnToLoad,
        cbm: Math.round(ctnToLoad * selectedEntry.cbmPerCtn * 100) / 100,
        weight: Math.round(ctnToLoad * selectedEntry.weightPerCtn * 100) / 100,
        cbmPerCtn: selectedEntry.cbmPerCtn,
        weightPerCtn: selectedEntry.weightPerCtn,
      },
    ])
    setAddEntryId('')
    setCtnToLoad(0)
    setCtnError(null)
  }

  const removeEntry = (index: number) => {
    setEntryRows((prev) => prev.filter((_, i) => i !== index))
  }

  const totalCtn = entryRows.reduce((s, r) => s + r.ctnCount, 0)
  const totalCbm = entryRows.reduce((s, r) => s + r.cbm, 0)
  const totalWeight = entryRows.reduce((s, r) => s + r.weight, 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setContainerIdError(null)
    setContainerNameError(null)
    setStatusError(null)
    setEntriesError(null)

    if (!containerId.trim()) {
      setContainerIdError('⚠️ Container ID is required (e.g. TCKU3456789)')
      containerIdRef.current?.focus()
      return
    }
    if (!containerName.trim()) {
      setContainerNameError('⚠️ Container Name is required')
      containerNameRef.current?.focus()
      return
    }
    if (!status) {
      setStatusError('⚠️ Please select a status')
      statusRef.current?.focus()
      return
    }
    if (!isEdit && entryRows.length === 0) {
      setEntriesError('⚠️ Add at least one product entry to the container')
      entriesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const rowErrors = entryRows.filter((r) => r.inTransitCtn > 0 && (r.ctnCount > r.inTransitCtn || r.ctnCount === 0))
    if (rowErrors.length > 0) {
      setEntriesError('⚠️ Fix CTN errors in the entries table (CTN must be > 0 and cannot exceed in-transit limit)')
      entriesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    const mergedEntries = (() => {
      const byEntry = new Map<string, number>()
      for (const r of entryRows) {
        byEntry.set(r.buyingEntryId, (byEntry.get(r.buyingEntryId) ?? 0) + r.ctnCount)
      }
      return Array.from(byEntry.entries()).map(([buyingEntryId, ctnCount]) => ({ buyingEntryId, ctnCount }))
    })()
    const payload = {
      containerId: containerId.trim(),
      containerName: containerName.trim(),
      remarks: remarks.trim() || undefined,
      status,
      loadingDate: loadingDate ? format(loadingDate, 'yyyy-MM-dd') : undefined,
      dispatchDate: dispatchDate ? format(dispatchDate, 'yyyy-MM-dd') : undefined,
      estimatedArrival: estimatedArrival ? format(estimatedArrival, 'yyyy-MM-dd') : undefined,
      arrivedDate: arrivedDate ? format(arrivedDate, 'yyyy-MM-dd') : undefined,
      entries: mergedEntries,
    }
    if (isEdit) {
      const result = await apiPut(`/api/containers/${editContainer!._id}`, payload)
      setSubmitting(false)
      if (result.success) {
        toast.success('Container updated')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    } else {
      const result = await apiPost('/api/containers', payload)
      setSubmitting(false)
      if (result.success) {
        toast.success('Container created')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto w-[75vw] max-w-[75vw] p-6">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Container' : 'Add Container'}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()

              const activeEl = document.activeElement as HTMLElement | null
              if (!activeEl) return

              const isSubmitButton =
                activeEl.tagName === 'BUTTON' &&
                (activeEl.textContent?.includes('Update') ||
                  activeEl.textContent?.includes('Create') ||
                  activeEl.textContent?.includes('Save'))

              if (isSubmitButton) {
                activeEl.click()
              }
            }
          }}
          className="mt-6 space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-4">
              <Label htmlFor="container-id">Container ID</Label>
              <Input
                id="container-id"
                ref={containerIdRef}
                className={containerIdError ? 'border-red-500' : ''}
                value={containerId}
                onChange={(e) => {
                  setContainerId(e.target.value)
                  if (containerIdError) setContainerIdError(null)
                }}
                placeholder="e.g. TCKU3456789"
                disabled={isEdit}
              />
              {containerIdError && <p className="text-xs text-red-500 mt-1">{containerIdError}</p>}
            </div>
            <div>
              <Label htmlFor="container-name">Container Name</Label>
              <Input
                id="container-name"
                ref={containerNameRef}
                className={containerNameError ? 'border-red-500' : ''}
                value={containerName}
                onChange={(e) => {
                  setContainerName(e.target.value)
                  if (containerNameError) setContainerNameError(null)
                }}
                placeholder="e.g. March Shipment 1"
              />
              {containerNameError && <p className="text-xs text-red-500 mt-1">{containerNameError}</p>}
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                ref={statusRef}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  if (statusError) setStatusError(null)
                }}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
                  statusError && 'border-red-500'
                )}
              >
                <option value="loading">Loading</option>
                <option value="in_transit">In Transit</option>
                <option value="customs_clearance">Customs Clearance</option>
                <option value="arrived">Arrived</option>
              </select>
              {statusError && <p className="text-xs text-red-500 mt-1">{statusError}</p>}
            </div>
            <DatePickerField
              id="loading-date"
              label="Loading Date"
              value={loadingDate}
              onChange={setLoadingDate}
            />
            <DatePickerField
              id="dispatch-date"
              label="Dispatch Date"
              value={dispatchDate}
              onChange={setDispatchDate}
            />
            <DatePickerField
              id="est-arrival"
              label="Est. Arrival"
              value={estimatedArrival}
              onChange={setEstimatedArrival}
            />
            <DatePickerField
              id="arrived-date"
              label="Arrived Date"
              value={arrivedDate}
              onChange={setArrivedDate}
            />
            <div className="lg:col-span-2">
              <Label>Remarks</Label>
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
          </div>

          {!isEdit && (
            <div ref={entriesSectionRef}>
              <h3 className="text-sm font-semibold mb-2">Products in Container</h3>
              <div className="flex flex-wrap gap-4 items-end">
                <div className="min-w-[220px]">
                  <Label className="text-xs">Add entry</Label>
                  <select
                    value={addEntryId}
                    onChange={(e) => {
                      const val = e.target.value
                      setAddEntryId(val)
                      const entry = availableEntries.find((ex) => ex._id === val)
                      setCtnToLoad(entry?.remainingCtn ?? 0)
                      setCtnError(null)
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    <option value="">Select entry</option>
                    {availableEntries.map((e) => (
                      <option key={e._id} value={e._id}>
                        {e.productName} — {e.mark} ({e.remainingCtn} CTN available to load)
                        {e.alreadyLoaded > 0 ? ` · ${e.alreadyLoaded} in other containers` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedEntry && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {maxCtn === 0
                        ? `${alreadyAddedCtn} CTN already added, 0 remaining`
                        : `${selectedEntry.remainingCtn} CTN available to load${alreadyAddedCtn > 0 ? ` (${alreadyAddedCtn} already added, ${maxCtn} remaining)` : ''}`}
                    </p>
                  )}
                </div>
                {selectedEntry && maxCtn > 0 && (
                  <div className="w-32">
                    <Label className="text-xs">CTN to Load</Label>
                    <Input
                      type="number"
                      min={1}
                      max={maxCtn}
                      value={ctnToLoad || ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : Number(e.target.value)
                        setCtnToLoad(val)
                        if (val > maxCtn) {
                          setCtnError(
                            `Cannot exceed ${maxCtn} CTN. ${selectedEntry?.alreadyLoaded ?? 0} CTN already in other containers.`
                          )
                        } else if (val < 1 && val !== 0) {
                          setCtnError('CTN must be greater than 0')
                        } else {
                          setCtnError(null)
                        }
                      }}
                      placeholder={`Max ${maxCtn}`}
                      className={ctnError ? 'border-red-500' : ''}
                    />
                    <p
                      className={cn(
                        'text-xs mt-1',
                        ctnToLoad > maxCtn || ctnToLoad < 0 ? 'text-red-500' : 'text-green-600'
                      )}
                    >
                      {ctnToLoad} / {selectedEntry?.remainingCtn ?? maxCtn} CTN ({(selectedEntry?.remainingCtn ?? maxCtn) - ctnToLoad} remaining after load)
                    </p>
                    {ctnError && <p className="text-xs text-red-500 mt-1">⚠️ {ctnError}</p>}
                  </div>
                )}
                <Button
                  type="button"
                  onClick={addEntry}
                  variant="secondary"
                  disabled={
                    !selectedEntry ||
                    maxCtn < 1 ||
                    ctnToLoad < 1 ||
                    ctnToLoad > maxCtn
                  }
                >
                  Add to Container
                </Button>
              </div>
              {loadingAvailable && <p className="text-xs text-muted-foreground mt-2">Loading entries…</p>}
              {entriesError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 mt-2">
                  <p className="text-sm text-red-600">{entriesError}</p>
                </div>
              )}
              <div className="rounded border overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Product</th>
                      <th className="p-2 text-left font-medium">Mark</th>
                      <th className="p-2 text-right font-medium">In Transit CTN</th>
                      <th className="p-2 text-right font-medium">CTN to Load</th>
                      <th className="p-2 text-right font-medium">CBM</th>
                      <th className="p-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {entryRows.map((r, i) => {
                      const hasError = r.inTransitCtn > 0 && (r.ctnCount > r.inTransitCtn || r.ctnCount === 0)
                      return (
                        <tr key={`row-${i}`} className={cn('border-b', hasError && 'bg-red-50')}>
                          <td className="p-2">{r.productName}</td>
                          <td className="p-2">{r.mark}</td>
                          <td className="p-2 text-right">{r.inTransitCtn}</td>
                          <td className="p-2 text-right">
                            <span className={hasError ? 'text-red-500 font-medium' : ''}>{r.ctnCount}</span>
                            {hasError && (
                              <p className="text-xs text-red-500">
                                {r.ctnCount === 0 ? 'CTN must be greater than 0' : `Exceeds ${r.inTransitCtn} CTN limit`}
                              </p>
                            )}
                          </td>
                          <td className="p-2 text-right">{r.cbm}</td>
                          <td className="p-2">
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeEntry(i)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-4 text-sm mt-2">
                <span>Total CTN: <strong>{totalCtn}</strong></span>
                <span>Total CBM: <strong>{totalCbm}</strong></span>
                <span>Total Weight: <strong>{totalWeight}</strong></span>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
