'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Ship, Pencil, CheckCircle, Check, X, Trash2, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ContainerFormSheet } from '@/components/containers/ContainerFormSheet'
import { Input } from '@/components/ui/input'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ContainerEntry {
  buyingEntry: string | { _id: string; mark?: string; entryDate?: string; inTransitCtn?: number }
  product: string | { _id: string; productName?: string }
  productName?: string
  mark?: string
  entryDate?: string
  ctnCount: number
  cbm: number
  weight?: number
  maxAllowedCtn?: number
}

interface ContainerDetail {
  _id: string
  containerId: string
  containerName: string
  remarks?: string
  status: string
  loadingDate?: string
  dispatchDate?: string
  estimatedArrival?: string
  arrivedDate?: string
  warehouseDate?: string
  reachedIndiaWarehouse: boolean
  entries: ContainerEntry[]
  totalCtn: number
  totalCbm: number
  totalWeight: number
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'loading': return 'bg-muted text-muted-foreground'
    case 'in_transit': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'customs_clearance': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
    case 'arrived': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
    default: return 'bg-muted text-muted-foreground'
  }
}

export default function ContainerDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [data, setData] = useState<ContainerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [warehouseSubmitting, setWarehouseSubmitting] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editCtnValue, setEditCtnValue] = useState<number>(0)
  const [entrySaveLoading, setEntrySaveLoading] = useState(false)
  const [deleteEntryConfirm, setDeleteEntryConfirm] = useState<string | null>(null)
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newEntryId, setNewEntryId] = useState('')
  const [newEntryCtn, setNewEntryCtn] = useState<number>(0)
  const [availableEntries, setAvailableEntries] = useState<{ _id: string; productName: string; mark: string; remainingCtn: number; alreadyLoaded?: number }[]>([])
  const [addEntryLoading, setAddEntryLoading] = useState(false)

  const fetchContainer = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<ContainerDetail>(`/api/containers/${id}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else {
      toast.error(result.message)
      router.push('/containers')
    }
  }, [id, router])

  useEffect(() => {
    fetchContainer()
  }, [fetchContainer])

  useEffect(() => {
    if (showAddEntry && id) {
      apiGet<{ entries: { _id: string; productName: string; mark: string; remainingCtn: number; alreadyLoaded?: number }[] }>(
        `/api/containers/available-entries?excludeContainerId=${encodeURIComponent(id)}`
      ).then((res) => {
        if (res.success && res.data?.entries) setAvailableEntries(res.data.entries)
        else setAvailableEntries([])
      })
    }
  }, [showAddEntry, id])

  async function handleWarehouseArrival() {
    setWarehouseSubmitting(true)
    const result = await apiPost<{ data: { updatedEntries: { productName: string; ctnMoved: number }[] } }>(
      `/api/containers/${id}/warehouse-arrival`,
      {}
    )
    setWarehouseSubmitting(false)
    if (result.success) {
      toast.success('Warehouse arrival recorded. CTN moved to available.')
      fetchContainer()
    } else toast.error(result.message)
  }

  if (loading || !data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  const entries = data.entries ?? []
  const productId = (e: ContainerEntry) =>
    typeof e.product === 'object' && e.product && '_id' in e.product ? (e.product as { _id: string })._id : e.product
  const productName = (e: ContainerEntry) =>
    e.productName ?? (typeof e.product === 'object' && e.product && 'productName' in e.product ? (e.product as { productName?: string }).productName : '—')
  const mark = (e: ContainerEntry) =>
    e.mark ?? (typeof e.buyingEntry === 'object' && e.buyingEntry && 'mark' in e.buyingEntry ? (e.buyingEntry as { mark?: string }).mark : '—')
  const entryDate = (e: ContainerEntry) =>
    e.entryDate ?? (typeof e.buyingEntry === 'object' && e.buyingEntry && 'entryDate' in e.buyingEntry ? (e.buyingEntry as { entryDate?: string }).entryDate : null)
  const buyingEntryId = (e: ContainerEntry): string =>
    typeof e.buyingEntry === 'object' && e.buyingEntry && '_id' in e.buyingEntry ? (e.buyingEntry as { _id: string })._id : String(e.buyingEntry)
  const inTransitCtn = (e: ContainerEntry): number =>
    typeof e.buyingEntry === 'object' && e.buyingEntry && 'inTransitCtn' in e.buyingEntry ? (e.buyingEntry as { inTransitCtn?: number }).inTransitCtn ?? 0 : 0

  const selectedNewEntry = availableEntries.find((e) => e._id === newEntryId)

  async function handleDeleteEntry(buyingEntryIdStr: string) {
    const result = await apiDelete(`/api/containers/${id}/entry?buyingEntryId=${encodeURIComponent(buyingEntryIdStr)}`)
    if (result.success) {
      setDeleteEntryConfirm(null)
      fetchContainer()
      toast.success('Entry removed from container')
    } else {
      toast.error(result.message ?? 'Failed to remove entry')
    }
  }

  async function handleAddNewEntry() {
    if (!newEntryId || !selectedNewEntry || newEntryCtn < 1 || newEntryCtn > selectedNewEntry.remainingCtn) {
      toast.error(`Enter CTN between 1 and ${selectedNewEntry?.remainingCtn ?? 0}`)
      return
    }
    setAddEntryLoading(true)
    const result = await apiPost(`/api/containers/${id}/entry`, { buyingEntryId: newEntryId, ctnCount: newEntryCtn })
    setAddEntryLoading(false)
    if (result.success) {
      setShowAddEntry(false)
      setNewEntryId('')
      setNewEntryCtn(0)
      fetchContainer()
      toast.success('Entry added to container')
    } else {
      toast.error(result.message ?? 'Failed to add entry')
    }
  }

  async function handleSaveCtn(buyingEntryIdStr: string) {
    const entry = entries.find((e) => buyingEntryId(e) === buyingEntryIdStr)
    if (!entry) return
    const maxAllowed = entry.maxAllowedCtn ?? entry.ctnCount
    if (editCtnValue <= 0) {
      toast.error('CTN must be greater than 0')
      return
    }
    if (editCtnValue > maxAllowed) {
      toast.error(`Cannot exceed ${maxAllowed} CTN`)
      return
    }
    setEntrySaveLoading(true)
    const result = await apiPut(`/api/containers/${id}/entry`, { buyingEntryId: buyingEntryIdStr, ctnCount: editCtnValue })
    setEntrySaveLoading(false)
    if (result.success) {
      setEditingEntryId(null)
      fetchContainer()
      toast.success('CTN updated')
    } else {
      toast.error(result.message ?? 'Failed to update CTN')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.containerId}
        description={data.containerName}
        breadcrumb={
          <>
            <Link href="/containers" className="text-muted-foreground hover:text-foreground">Containers</Link>
            <span className="text-muted-foreground"> / </span>
            <span>{data.containerName}</span>
          </>
        }
        action={
          <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn('text-sm', statusBadgeClass(data.status))}>
          {data.status.replace('_', ' ')}
        </Badge>
        {data.reachedIndiaWarehouse && (
          <Badge variant="outline" className="text-emerald-600 border-emerald-200">
            🏭 In India Warehouse
          </Badge>
        )}
      </div>

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total CTN</p>
            <p className="text-xl font-semibold">{data.totalCtn}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total CBM</p>
            <p className="text-xl font-semibold">{data.totalCbm}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Weight</p>
            <p className="text-xl font-semibold">{data.totalWeight}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Products</p>
            <p className="text-xl font-semibold">{entries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-sm font-semibold capitalize">{data.status.replace('_', ' ')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Shipment Timeline</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: '📦 Loading', date: data.loadingDate, done: !!data.loadingDate },
            { label: '🚢 Dispatched', date: data.dispatchDate, done: !!data.dispatchDate },
            { label: '🛃 Customs Clearance', date: null, done: data.status === 'customs_clearance' || data.status === 'arrived' },
            { label: 'ⓐ Arrived India Port', date: data.arrivedDate, done: !!data.arrivedDate },
            { label: '🏭 Reached India Warehouse', date: data.warehouseDate, done: data.reachedIndiaWarehouse },
          ].map((step, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 text-sm',
                step.done ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-xs', step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted')}>
                {step.done ? '✓' : '·'}
              </span>
              <span>{step.label}</span>
              {step.date && <span className="text-muted-foreground">{format(new Date(step.date), 'dd MMM yyyy')}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Products in container table */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Products in Container</h2>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No entries in this container.</p>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Product</th>
                    <th className="p-3 text-left font-medium">Mark</th>
                    <th className="p-3 text-left font-medium">Entry Date</th>
                    <th className="p-3 text-right font-medium">In Transit</th>
                    <th className="p-3 text-right font-medium">CTN in Container</th>
                    <th className="p-3 text-right font-medium">CBM</th>
                    <th className="p-3 text-right font-medium">Weight</th>
                    <th className="p-3 w-12 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, idx) => {
                    const beId = buyingEntryId(e)
                    const isEditing = editingEntryId === beId
                    const maxAllowed = e.maxAllowedCtn ?? e.ctnCount
                    const canEdit = !data.reachedIndiaWarehouse
                    return (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="p-3">
                          <Link
                            href={`/products/${productId(e)}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {productName(e)}
                          </Link>
                        </td>
                        <td className="p-3">{mark(e)}</td>
                        <td className="p-3">{entryDate(e) ? format(new Date(entryDate(e) as string), 'dd MMM yyyy') : '—'}</td>
                        <td className="p-3 text-right text-blue-600">{inTransitCtn(e)} CTN</td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <div className="flex items-center gap-1 justify-end">
                              <Input
                                type="number"
                                value={editCtnValue}
                                min={1}
                                max={maxAllowed}
                                className="w-20 h-7 text-sm"
                                onChange={(ev) => setEditCtnValue(Number(ev.target.value) || 0)}
                                onKeyDown={(ev) => {
                                  if (ev.key === 'Enter') handleSaveCtn(beId)
                                  if (ev.key === 'Escape') setEditingEntryId(null)
                                }}
                                autoFocus
                              />
                              <span className="text-xs text-muted-foreground">/ {maxAllowed}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-600 hover:text-green-700"
                                onClick={() => handleSaveCtn(beId)}
                                disabled={entrySaveLoading}
                                aria-label="Save"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setEditingEntryId(null)}
                                aria-label="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div
                              className={cn('flex items-center gap-2 justify-end w-fit', canEdit && 'cursor-pointer group')}
                              onClick={() => canEdit && (setEditingEntryId(beId), setEditCtnValue(e.ctnCount))}
                              role={canEdit ? 'button' : undefined}
                              tabIndex={canEdit ? 0 : undefined}
                              onKeyDown={
                                canEdit
                                  ? (ev) => {
                                      if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault()
                                        setEditingEntryId(beId)
                                        setEditCtnValue(e.ctnCount)
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <span className="font-medium">{e.ctnCount} CTN</span>
                              {canEdit && (
                                <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right">{e.cbm}</td>
                        <td className="p-3 text-right">{e.weight ?? '—'} kg</td>
                        <td className="p-3">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteEntryConfirm(beId)}
                              aria-label="Remove from container"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50 font-medium">
                    <td className="p-3" colSpan={3}>
                      Total
                    </td>
                    <td className="p-3 text-right" />
                    <td className="p-3 text-right">{data.totalCtn} CTN</td>
                    <td className="p-3 text-right">{data.totalCbm}</td>
                    <td className="p-3 text-right">{data.totalWeight} kg</td>
                    <td className="p-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!data.reachedIndiaWarehouse && (
            <>
              <button
                type="button"
                onClick={() => setShowAddEntry((v) => !v)}
                className="mt-3 text-sm text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                {showAddEntry ? 'Cancel' : 'Add Product Entry'}
              </button>
              {showAddEntry && (
                <div className="mt-3 p-3 border rounded-lg bg-muted/40 space-y-2">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <Label className="text-xs">Select Entry</Label>
                      <Select value={newEntryId} onValueChange={(v) => { setNewEntryId(v); setNewEntryCtn(0) }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select product entry..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableEntries.map((entry) => (
                            <SelectItem key={entry._id} value={entry._id}>
                              {entry.productName} — {entry.mark} ({entry.remainingCtn} CTN available)
                              {(entry.alreadyLoaded ?? 0) > 0 && ` · ${entry.alreadyLoaded} in other containers`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-32">
                      <Label className="text-xs">CTN to Load</Label>
                      <Input
                        type="number"
                        value={newEntryCtn || ''}
                        min={1}
                        max={selectedNewEntry?.remainingCtn ?? 0}
                        onChange={(ev) => setNewEntryCtn(Number(ev.target.value) || 0)}
                        placeholder={selectedNewEntry ? `Max ${selectedNewEntry.remainingCtn}` : '0'}
                      />
                    </div>
                    <Button onClick={handleAddNewEntry} disabled={addEntryLoading || !selectedNewEntry || newEntryCtn < 1 || (selectedNewEntry && newEntryCtn > selectedNewEntry.remainingCtn)}>
                      Add
                    </Button>
                    <Button variant="outline" onClick={() => { setShowAddEntry(false); setNewEntryId(''); setNewEntryCtn(0) }}>
                      Cancel
                    </Button>
                  </div>
                  {selectedNewEntry && (
                    <p className="text-xs text-muted-foreground">
                      {newEntryCtn} / {selectedNewEntry.remainingCtn} CTN
                      ({selectedNewEntry.remainingCtn - newEntryCtn} remaining after load)
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Warehouse arrival section */}
      {data.status === 'arrived' && !data.reachedIndiaWarehouse && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-2">Container reached India warehouse?</h3>
            <p className="text-sm text-muted-foreground mb-2">
              This will move <strong>{data.totalCtn}</strong> CTN from In Transit → Available (ready to sell).
            </p>
            <p className="text-sm text-muted-foreground mb-2">Products affected: {entries.length}</p>
            <ul className="text-sm list-disc list-inside mb-4">
              {entries.map((e, idx) => (
                <li key={idx}>{productName(e)} — {e.ctnCount} CTN</li>
              ))}
            </ul>
            <Button onClick={handleWarehouseArrival} disabled={warehouseSubmitting}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {warehouseSubmitting ? 'Confirming…' : 'Confirm Warehouse Arrival'}
            </Button>
          </CardContent>
        </Card>
      )}

      {data.reachedIndiaWarehouse && data.warehouseDate && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            ✅ Arrived in India Warehouse on {format(new Date(data.warehouseDate), 'dd MMM yyyy')}
          </p>
        </div>
      )}

      <AlertDialog open={!!deleteEntryConfirm} onOpenChange={(open) => !open && setDeleteEntryConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this product entry from the container. The CTN will remain in transit and can be added to another container.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDeleteEntryConfirm(null)}>Cancel</AlertDialogAction>
            <Button
              variant="destructive"
              onClick={() => deleteEntryConfirm && handleDeleteEntry(deleteEntryConfirm)}
            >
              Remove Entry
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContainerFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={fetchContainer}
        editContainer={{
          _id: data._id,
          containerId: data.containerId,
          containerName: data.containerName,
          remarks: data.remarks,
          status: data.status,
          loadingDate: data.loadingDate,
          dispatchDate: data.dispatchDate,
          estimatedArrival: data.estimatedArrival,
          arrivedDate: data.arrivedDate,
          entries: entries.map((e) => ({
            buyingEntry: typeof e.buyingEntry === 'object' && e.buyingEntry && '_id' in e.buyingEntry ? (e.buyingEntry as { _id: string })._id : String(e.buyingEntry),
            productName: productName(e),
            mark: mark(e),
            ctnCount: e.ctnCount,
            cbm: e.cbm,
            weight: e.weight,
          })),
        }}
      />
    </div>
  )
}
