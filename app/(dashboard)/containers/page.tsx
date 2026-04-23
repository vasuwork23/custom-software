'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Ship, Plus, CheckCircle, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { ContainerFormSheet } from '@/components/containers/ContainerFormSheet'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiGet, apiPut, apiPost, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type StatusFilter = 'all' | 'loading' | 'in_transit' | 'customs_clearance' | 'arrived' | 'inWarehouse'

interface ContainerEntry {
  buyingEntry: string
  product?: string
  productName?: string
  mark?: string
  entryDate?: string
  ctnCount: number
  cbm: number
  weight?: number
}

interface ContainerItem {
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
  createdAt: string
}

interface ContainersData {
  containers: ContainerItem[]
  counts: {
    all: number
    loading: number
    in_transit: number
    customs_clearance: number
    arrived: number
    inWarehouse: number
  }
  summary: { totalCtn: number }
}

export default function ContainersPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ContainersData | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingContainer, setEditingContainer] = useState<ContainerItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const { user } = useAuthStore()

  const fetchContainers = useCallback(async () => {
    setLoading(true)
    const result = await apiGet<ContainersData>('/api/containers')
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [])

  useEffect(() => {
    fetchContainers()
  }, [fetchContainers])

  const containers = data?.containers ?? []

  const counts = useMemo(
    () => ({
      all: containers.length,
      loading: containers.filter((c) => c.status === 'loading').length,
      in_transit: containers.filter((c) => c.status === 'in_transit').length,
      customs_clearance: containers.filter((c) => c.status === 'customs_clearance').length,
      arrived: containers.filter((c) => c.status === 'arrived').length,
      inWarehouse: containers.filter((c) => c.reachedIndiaWarehouse).length,
      totalCtn: containers.reduce((s, c) => s + c.totalCtn, 0),
    }),
    [containers]
  )

  const filteredContainers = useMemo(() => {
    if (!containers.length) return []
    if (statusFilter === 'all') return containers
    if (statusFilter === 'inWarehouse') return containers.filter((c) => c.reachedIndiaWarehouse)
    return containers.filter((c) => c.status === statusFilter)
  }, [containers, statusFilter])

  const filterPills: { id: StatusFilter; label: string; count: number }[] = data
    ? [
        { id: 'all', label: 'All', count: counts.all },
        { id: 'loading', label: '🔄 Loading', count: counts.loading },
        { id: 'in_transit', label: '🚢 In Transit', count: counts.in_transit },
        { id: 'customs_clearance', label: '🛃 Customs', count: counts.customs_clearance },
        { id: 'arrived', label: '✅ Arrived', count: counts.arrived },
        { id: 'inWarehouse', label: '🏭 In Warehouse', count: counts.inWarehouse },
      ]
    : []

  const handleStatusChange = useCallback(
    async (container: ContainerItem, newStatus: string) => {
      const previousStatus = container.status
      setData((prev) =>
        prev
          ? {
              ...prev,
              containers: prev.containers.map((c) =>
                c._id === container._id ? { ...c, status: newStatus } : c
              ),
            }
          : null
      )
      try {
        const result = await apiPut(`/api/containers/${container._id}`, {
          status: newStatus,
          ...(newStatus === 'arrived' && { arrivedDate: new Date().toISOString() }),
        })
        if (!result.success) throw new Error(result.message)
        fetchContainers()
      } catch {
        setData((prev) =>
          prev
            ? {
                ...prev,
                containers: prev.containers.map((c) =>
                  c._id === container._id ? { ...c, status: previousStatus } : c
                ),
              }
            : null
        )
        toast.error('Failed to update status')
      }
    },
    [fetchContainers]
  )

  const handleDeleteContainer = useCallback(
    async (containerId: string) => {
      try {
        const result = await apiDelete(`/api/containers/${containerId}`)
        if (result.success) {
          setData((prev) =>
            prev
              ? { ...prev, containers: prev.containers.filter((c) => c._id !== containerId) }
              : null
          )
          toast.success('Container deleted')
        } else {
          toast.error(result.message ?? 'Failed to delete container')
        }
      } catch {
        toast.error('Failed to delete container')
      }
      setDeleteConfirm(null)
    },
    []
  )

  const [warehouseSubmittingId, setWarehouseSubmittingId] = useState<string | null>(null)
  const handleWarehouseArrival = useCallback(
    async (containerId: string) => {
      setWarehouseSubmittingId(containerId)
      const container = containers.find((c) => c._id === containerId)
      setData((prev) =>
        prev
          ? {
              ...prev,
              containers: prev.containers.map((c) =>
                c._id === containerId
                  ? { ...c, reachedIndiaWarehouse: true, warehouseDate: new Date().toISOString() }
                  : c
              ),
            }
          : null
      )
      try {
        const result = await apiPost(`/api/containers/${containerId}/warehouse-arrival`, {})
        if (!result.success) throw new Error(result.message)
        fetchContainers()
      } catch {
        setData((prev) =>
          prev
            ? {
                ...prev,
                containers: prev.containers.map((c) =>
                  c._id === containerId && container
                    ? { ...c, reachedIndiaWarehouse: container.reachedIndiaWarehouse, warehouseDate: container.warehouseDate }
                    : c
                ),
              }
            : null
        )
        toast.error('Failed to mark warehouse arrival')
      } finally {
        setWarehouseSubmittingId(null)
      }
    },
    [containers, fetchContainers]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Containers"
        description="Track shipment containers from China to India."
        action={
          <Button onClick={() => { setEditingContainer(null); setSheetOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Add Container
          </Button>
        }
      />

      {loading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : !data?.containers.length ? (
        <EmptyState
          icon={Ship}
          title="No containers yet"
          description="Add your first container to track shipments from China to India."
        >
          <Button onClick={() => setSheetOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Container
          </Button>
        </EmptyState>
      ) : (
        <>
          {/* Summary stats bar — derived from containers so they update live on status change */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-3 bg-muted rounded-lg border">
            <div className="flex flex-col items-center rounded-lg border bg-background p-2">
              <span className="mb-1 text-xs text-muted-foreground">🔄 Loading</span>
              <span className="text-lg font-bold text-foreground">{counts.loading}</span>
              <span className="text-xs text-muted-foreground">containers</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-blue-100 bg-blue-50 p-2 dark:bg-blue-900/20">
              <span className="mb-1 text-xs text-muted-foreground">🚢 In Transit</span>
              <span className="text-lg font-bold text-blue-600">{counts.in_transit}</span>
              <span className="text-xs text-muted-foreground">containers</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-amber-100 bg-amber-50 p-2 dark:bg-amber-900/20">
              <span className="mb-1 text-xs text-muted-foreground">🛃 Customs</span>
              <span className="text-lg font-bold text-amber-600">{counts.customs_clearance}</span>
              <span className="text-xs text-muted-foreground">containers</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-emerald-100 bg-emerald-50 p-2 dark:bg-emerald-900/20">
              <span className="mb-1 text-xs text-muted-foreground">✅ Arrived</span>
              <span className="text-lg font-bold text-emerald-600">{counts.arrived}</span>
              <span className="text-xs text-muted-foreground">containers</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border bg-background p-2 col-span-2 lg:col-span-1">
              <span className="mb-1 text-xs text-muted-foreground">Total CTN</span>
              <span className="text-lg font-bold text-foreground">{counts.totalCtn}</span>
              <span className="text-xs text-muted-foreground">across all</span>
            </div>
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            {filterPills.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  statusFilter === f.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                )}
              >
                <span>{f.label}</span>
                <span
                  className={cn(
                    'ml-1 inline-flex items-center rounded-full px-1.5 text-[10px]',
                    statusFilter === f.id ? 'bg-white/20' : 'bg-background/60'
                  )}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* Container cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredContainers.map((c) => (
              <Link key={c._id} href={`/containers/${c._id}`}>
                <Card className="transition-shadow hover:shadow-md h-full relative">
                  <CardContent className="p-4">
                    {(user?.role === 'owner' || user?.role === 'admin') && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setDeleteConfirm(c._id)
                        }}
                        className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-colors z-10"
                        aria-label="Delete container"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="font-semibold text-sm">{c.containerId}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.containerName}</p>
                      </div>
                      <Select
                        value={c.status}
                        onValueChange={(newStatus) => handleStatusChange(c, newStatus)}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-7 w-36 text-xs font-medium border-0 px-2 shrink-0',
                            c.status === 'loading' &&
                              'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                            c.status === 'in_transit' &&
                              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                            c.status === 'customs_clearance' &&
                              'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                            c.status === 'arrived' &&
                              'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent onClick={(e) => e.stopPropagation()}>
                          <SelectItem value="loading">
                            <div className="flex items-center gap-2">
                              <span>📦</span> Loading
                            </div>
                          </SelectItem>
                          <SelectItem value="in_transit">
                            <div className="flex items-center gap-2">
                              <span>🚢</span> In Transit
                            </div>
                          </SelectItem>
                          <SelectItem value="customs_clearance">
                            <div className="flex items-center gap-2">
                              <span>🛃</span> Customs Clearance
                            </div>
                          </SelectItem>
                          <SelectItem value="arrived">
                            <div className="flex items-center gap-2">
                              <span>⚓</span> Arrived
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total CTN</span>
                        <span className="font-semibold">{c.totalCtn}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total CBM</span>
                        <span className="font-semibold">{c.totalCbm}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Weight</span>
                        <span className="font-semibold">{c.totalWeight}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Products</span>
                        <span className="font-semibold">{c.entries?.length ?? 0}</span>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {c.dispatchDate && (
                        <p>Dispatch: {format(new Date(c.dispatchDate), 'dd MMM yyyy')}</p>
                      )}
                      {c.estimatedArrival && (
                        <p>ETA: {format(new Date(c.estimatedArrival), 'dd MMM yyyy')}</p>
                      )}
                      {c.arrivedDate && (
                        <p>Arrived: {format(new Date(c.arrivedDate), 'dd MMM yyyy')}</p>
                      )}
                    </div>
                    {c.status === 'arrived' && !c.reachedIndiaWarehouse && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleWarehouseArrival(c._id)
                        }}
                        disabled={warehouseSubmittingId === c._id}
                        className="w-full mt-2 text-xs bg-green-50 border border-green-200 text-green-700 rounded-md py-1.5 hover:bg-green-100 transition-colors dark:bg-green-900/20 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900/30 disabled:opacity-50"
                      >
                        {warehouseSubmittingId === c._id ? 'Updating…' : '🏭 Mark as Reached India Warehouse'}
                      </button>
                    )}
                    {c.reachedIndiaWarehouse && (
                      <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 shrink-0" />
                        Reached India Warehouse
                        {c.warehouseDate &&
                          ` · ${format(new Date(c.warehouseDate), 'dd MMM yyyy')}`}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {statusFilter !== 'all' && (
            <p className="text-xs text-muted-foreground">
              Showing filtered results ({filteredContainers.length}{' '}
              {filteredContainers.length === 1 ? 'container' : 'containers'})
            </p>
          )}
        </>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Container?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm && (() => {
                const container = filteredContainers.find((c) => c._id === deleteConfirm)
                return container && container.status !== 'loading' ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    ⚠️ This container is &quot;{container.status.replace('_', ' ')}&quot;. Deleting it will not
                    restore any CTN counts. Are you absolutely sure?
                  </span>
                ) : (
                  'This will permanently delete the container. This action cannot be undone.'
                )
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDeleteConfirm(null)}>Cancel</AlertDialogAction>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDeleteContainer(deleteConfirm)}
            >
              Delete Container
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContainerFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={fetchContainers}
        editContainer={editingContainer ?? undefined}
      />
    </div>
  )
}
