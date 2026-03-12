'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Pencil, Trash2, ChevronDown, ChevronRight, Ship } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { LockButton } from '@/components/products/LockButton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface BuyingEntryRow {
  _id: string
  mark: string
  entryDate: string
  totalCtn: number
  qty: number
  rate: number
  cbm: number
  weight: number
  givenAmount: number
  hasAdvancePayment?: boolean
  advanceAmount?: number
  advanceChinaPerson?: string
  advanceDate?: string
  advanceNote?: string
  totalQty: number
  totalCbm: number
  totalWeight: number
  totalAmount: number
  totalExpenseINR: number
  remainingAmount: number
  totalCarrying: number
  perPisShipping: number
  rmbInrPurchase: number
  finalCost: number
  currentStatus: string
  chinaWarehouseReceived: 'yes' | 'no'
  chinaWarehouseCtn?: number
  inTransitCtn?: number
   soldCtn?: number
  isLocked: boolean
  lockedAt?: string
  availableCtn: number
  carryingRate?: number
  avgRmbRate?: number
  containerId?: string | { _id: string; containerId: string; containerName: string; status: string } | null
  containers?: { _id: string; containerId: string; containerName: string; status: string; ctnCount: number }[]
  unassignedCtn?: number
}

interface BuyingEntryTableProps {
  productId: string
  onRefresh: () => void
  onEdit: (entry: BuyingEntryRow) => void
  onAdd: () => void
  onMakePayment?: () => void
}

export function BuyingEntryTable({ productId, onRefresh, onEdit, onAdd, onMakePayment }: BuyingEntryTableProps) {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<BuyingEntryRow[]>([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)
  const [paymentsByEntry, setPaymentsByEntry] = useState<Record<string, { _id: string; amount: number; paymentDate: string; chinaPersonName?: string; notes?: string }[]>>({})
  const [paymentsLoading, setPaymentsLoading] = useState<string | null>(null)
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<{
    entry: BuyingEntryRow
    totalPaid: number
    paymentCount: number
    lockedAmount?: number
  } | null>(null)
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false)

  /** Use same formula as form/API so lock button and display match even if DB availableCtn is stale. Round to 2 decimals. */
  function calculatedAvailableCtn(entry: BuyingEntryRow): number {
    return parseFloat(
      Math.max(
        0,
        entry.totalCtn -
          (entry.chinaWarehouseCtn ?? 0) -
          (entry.inTransitCtn ?? 0) -
          (entry.soldCtn ?? 0)
      ).toFixed(2)
    )
  }

  function stockBadge(entry: BuyingEntryRow) {
    const available = calculatedAvailableCtn(entry)
    const soldCtn = entry.soldCtn ?? 0
    if (soldCtn === 0) {
      return <Badge variant="outline" className="border-green-600 text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-300 dark:border-green-700">Available</Badge>
    }
    if (available === 0) {
      return <Badge variant="outline" className="border-red-600 text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-300 dark:border-red-700">Fully Sold</Badge>
    }
    return <Badge variant="outline" className="border-amber-600 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700">Partially Sold</Badge>
  }

  function availableCtnClass(entry: BuyingEntryRow) {
    const available = calculatedAvailableCtn(entry)
    const sold = entry.soldCtn ?? 0
    if (entry.chinaWarehouseReceived === 'no') return 'text-gray-500'
    if (available > 0) return 'text-green-600'
    if (sold >= entry.totalCtn) return 'text-gray-400'
    return 'text-gray-400'
  }

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (warehouseFilter === 'all') return true
      if (warehouseFilter === 'yes') return entry.chinaWarehouseReceived === 'yes'
      if (warehouseFilter === 'no') return entry.chinaWarehouseReceived === 'no'
      return true
    })
  }, [entries, warehouseFilter])

  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (acc, e) => {
        acc.totalCtn += e.totalCtn
        acc.availableCtn += calculatedAvailableCtn(e)
        acc.totalQty += e.totalQty
        acc.totalAmount += e.totalAmount
        acc.totalExpenseINR += e.totalExpenseINR ?? 0
        acc.givenAmount += e.givenAmount
        acc.remainingAmount += e.remainingAmount
        return acc
      },
      {
        totalCtn: 0,
        availableCtn: 0,
        totalQty: 0,
        totalAmount: 0,
        totalExpenseINR: 0,
        givenAmount: 0,
        remainingAmount: 0,
      }
    )
  }, [filteredEntries])

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const result = await apiGet<{ entries: BuyingEntryRow[]; pagination: { page: number; pages: number; total: number } }>(
      `/api/buying-entries?productId=${productId}&limit=20`
    )
    setLoading(false)
    if (result.success) {
      setEntries(result.data.entries)
      setPagination(result.data.pagination)
    } else toast.error(result.message)
  }, [productId])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  async function handleDelete(entryId: string) {
    const result = await apiDelete(`/api/buying-entries/${entryId}`)
    if (result.success) {
      toast.success('Entry deleted')
      setDeleteConfirm(null)
      fetchEntries()
      onRefresh()
    } else toast.error(result.message ?? result.error)
  }

  async function handleDeleteClick(entry: BuyingEntryRow) {
    if (entry.isLocked) return
    setDeleteSummaryLoading(true)
    const res = await apiGet<{ totalPaid: number; paymentCount: number }>(
      `/api/buying-entries/${entry._id}/payment-summary`
    )
    setDeleteSummaryLoading(false)
    if (res.success) {
      setDeleteConfirm({
        entry,
        totalPaid: res.data.totalPaid,
        paymentCount: res.data.paymentCount,
        lockedAmount: entry.isLocked ? (entry as { lockedAmount?: number }).lockedAmount : undefined,
      })
    } else {
      toast.error(res.message)
    }
  }

  async function fetchPaymentsForEntry(entryId: string) {
    setPaymentsLoading(entryId)
    const result = await apiGet<{ payments: { _id: string; amount: number; paymentDate: string; chinaPersonName?: string; notes?: string }[] }>(
      `/api/buying-payments?buyingEntryId=${entryId}`
    )
    setPaymentsLoading(null)
    if (result.success) setPaymentsByEntry((prev) => ({ ...prev, [entryId]: result.data.payments }))
  }

  function toggleExpand(entryId: string) {
    if (expandedEntryId === entryId) {
      setExpandedEntryId(null)
      return
    }
    setExpandedEntryId(entryId)
    if (!paymentsByEntry[entryId]) fetchPaymentsForEntry(entryId)
  }

  async function handleDeletePayment(paymentId: string, entryId: string) {
    const result = await apiDelete(`/api/buying-payments/${paymentId}`)
    if (result.success) {
      toast.success('Payment deleted')
      setPaymentsByEntry((prev) => ({ ...prev, [entryId]: (prev[entryId] ?? []).filter((p) => p._id !== paymentId) }))
      fetchEntries()
      onRefresh()
    } else toast.error(result.message ?? result.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select value={warehouseFilter} onValueChange={(v) => setWarehouseFilter(v as 'all' | 'yes' | 'no')}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Warehouse Received" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entries</SelectItem>
              <SelectItem value="no">🏭 China Factory (Not received)</SelectItem>
              <SelectItem value="yes">✅ Warehouse received</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          {onMakePayment && (
            <Button variant="outline" onClick={onMakePayment}>
              Make Payment
            </Button>
          )}
          <Button onClick={onAdd}>Add Buying Entry</Button>
        </div>
      </div>
      <div className="w-full overflow-hidden rounded-md border">
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            No buying entries. Add one to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 w-10 px-2" />
                <th className="h-10 px-4 text-left font-medium whitespace-nowrap">Mark</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">CTN</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">QTY/Pcs</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Available CTN</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Available pcs</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Total CBM</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Total weight</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Rate (¥)</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Total Amount (¥)</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Final Cost (₹)</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Total Expense (₹)</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Given (¥)</th>
                <th className="h-10 px-4 text-right font-medium whitespace-nowrap">Remaining (¥)</th>
                <th className="h-10 px-4 text-center font-medium whitespace-nowrap">Status</th>
                <th className="h-10 px-4 text-center font-medium whitespace-nowrap">Lock</th>
                <th className="h-10 w-24 px-4" />
              </tr>
            </thead>
                <tbody>
              {filteredEntries.map((entry) => (
                <React.Fragment key={entry._id}>
                  <tr className="border-b hover:bg-muted/50">
                    <td className="p-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleExpand(entry._id)}
                        aria-label={expandedEntryId === entry._id ? 'Collapse payments' : 'Expand payments'}
                      >
                        {expandedEntryId === entry._id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </td>
                    <td className="p-4 whitespace-nowrap font-medium">
                      <span>{entry.mark}</span>
                      {(entry.inTransitCtn ?? 0) > 0 && (!entry.containers || entry.containers.length === 0) && (
                        <Badge variant="outline" className="ml-1 text-[10px] border-amber-500 text-amber-700">
                          ⚠️ Not in container
                        </Badge>
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      {entry.totalCtn}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">{entry.totalQty}</td>
                    <td className="p-4 text-right whitespace-nowrap font-medium">
                      {entry.chinaWarehouseReceived === 'no' ? (
                        <span className="text-xs text-gray-500">🏭 At Factory</span>
                      ) : (
                        <span className={availableCtnClass(entry)}>{calculatedAvailableCtn(entry)}</span>
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      {entry.chinaWarehouseReceived === 'no' ? (
                        <span className="text-xs text-gray-500">—</span>
                      ) : (
                        Math.round(calculatedAvailableCtn(entry) * (entry.qty ?? 0))
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap tabular-nums">{entry.totalCbm ?? 0}</td>
                    <td className="p-4 text-right whitespace-nowrap tabular-nums">{entry.totalWeight ?? 0}</td>
                    <td className="p-4 text-right whitespace-nowrap">
                      ¥
                      {new Intl.NumberFormat('en-IN', {
                        maximumFractionDigits: 0,
                      }).format(entry.rate)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      ¥
                      {new Intl.NumberFormat('en-IN', {
                        maximumFractionDigits: 0,
                      }).format(entry.totalAmount)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap tabular-nums">
                      ₹{Number(entry.finalCost).toFixed(5)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      ₹
                      {new Intl.NumberFormat('en-IN', {
                        maximumFractionDigits: 0,
                      }).format(entry.totalExpenseINR ?? 0)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      ¥
                      {new Intl.NumberFormat('en-IN', {
                        maximumFractionDigits: 0,
                      }).format(entry.givenAmount)}
                    </td>
                    <td
                      className={`p-4 text-right whitespace-nowrap ${
                        entry.remainingAmount > 0 ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      ¥
                      {new Intl.NumberFormat('en-IN', {
                        maximumFractionDigits: 0,
                      }).format(entry.remainingAmount)}
                    </td>
                    <td className="p-4 text-center whitespace-nowrap">
                      <StatusBadge
                        status={
                          entry.currentStatus as
                            | 'paid'
                            | 'unpaid'
                            | 'partiallypaid'
                        }
                      />
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <div className="flex justify-center">
                        <LockButton
                          entryId={entry._id}
                          isLocked={entry.isLocked}
                          canLock={
                            !entry.isLocked &&
                            entry.chinaWarehouseReceived === 'yes' &&
                            (entry.avgRmbRate ?? 0) > 0 &&
                            (entry.carryingRate ?? 0) > 0 &&
                            (entry.totalCtn ?? 0) > 0
                          }
                          totalCtn={entry.totalCtn}
                          chinaWarehouseCtn={entry.chinaWarehouseCtn}
                          inTransitCtn={entry.inTransitCtn}
                          availableCtn={calculatedAvailableCtn(entry)}
                          soldCtn={entry.soldCtn}
                          chinaWarehouseReceived={entry.chinaWarehouseReceived}
                          avgRmbRate={entry.avgRmbRate}
                          carryingRate={entry.carryingRate}
                          totalExpenseINR={entry.totalExpenseINR}
                          qty={entry.qty}
                          finalCost={entry.finalCost}
                          onSuccess={fetchEntries}
                        />
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(entry)}
                          aria-label="Edit"
                          disabled={entry.isLocked}
                          title={entry.isLocked ? 'Unlock entry first to edit' : 'Edit'}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDialog
                          open={!!deleteConfirm && deleteConfirm.entry._id === entry._id}
                          onOpenChange={(open) => !open && setDeleteConfirm(null)}
                          title="Delete buying entry"
                          description={
                            deleteConfirm?.entry._id === entry._id
                              ? [
                                  'This cannot be undone. You cannot delete if sales exist against this entry.',
                                  deleteConfirm.totalPaid > 0 &&
                                    `¥${deleteConfirm.totalPaid.toLocaleString()} total will be restored to China person (${deleteConfirm.paymentCount} payment${deleteConfirm.paymentCount !== 1 ? 's' : ''}).`,
                                  deleteConfirm.lockedAmount != null &&
                                    Number(deleteConfirm.lockedAmount) > 0 &&
                                    `₹${Number(deleteConfirm.lockedAmount).toLocaleString('en-IN')} lock will be reversed from China Bank.`,
                                ]
                                  .filter(Boolean)
                                  .join(' ')
                              : 'Loading…'
                          }
                          confirmLabel="Delete"
                          variant="destructive"
                          onConfirm={() => handleDelete(entry._id)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label="Delete"
                              disabled={entry.isLocked || deleteSummaryLoading}
                              title={entry.isLocked ? 'Unlock entry first to delete' : 'Delete'}
                              onClick={() => handleDeleteClick(entry)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                  {expandedEntryId === entry._id && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={17} className="p-0">
                        {paymentsLoading === entry._id ? (
                          <div className="flex justify-center py-4">
                            <LoadingSpinner size="sm" />
                          </div>
                        ) : (
                          <div className="p-4 bg-muted/40 space-y-4">
                            {/* Section 1 — Entry Details */}
                            <div className="rounded border bg-background p-4 text-xs md:text-sm">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total CTN</span>
                                  <span className="font-semibold">{entry.totalCtn}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">QTY per CTN</span>
                                  <span className="font-semibold">{entry.qty}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total QTY/Pcs</span>
                                  <span className="font-semibold">{entry.totalQty}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Rate per piece</span>
                                  <span className="font-semibold">¥{entry.rate}</span>
                                </div>

                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total Amount (RMB)</span>
                                  <span className="font-semibold">
                                    <AmountDisplay amount={entry.totalAmount} currency="RMB" />
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Avg RMB Rate</span>
                                  <span className="font-semibold">
                                    {entry.avgRmbRate != null ? entry.avgRmbRate : '—'}
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">RMB → INR Value</span>
                                  <span className="font-semibold">
                                    <AmountDisplay amount={entry.rmbInrPurchase} />
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Carrying Rate</span>
                                  <span className="font-semibold">
                                    {entry.carryingRate != null ? entry.carryingRate : '—'}
                                  </span>
                                </div>

                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total Carrying (₹)</span>
                                  <span className="font-semibold">
                                    <AmountDisplay amount={entry.totalCarrying} />
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Shipping Cost per piece</span>
                                  <span className="font-semibold text-orange-600">
                                    ₹{(entry.totalQty > 0 ? entry.totalCarrying / entry.totalQty : 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total Expense INR</span>
                                  <span className="font-semibold text-blue-600">
                                    <AmountDisplay amount={entry.totalExpenseINR} />
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Final Cost per piece</span>
                                  <span className="font-semibold text-emerald-600">
                                    <AmountDisplay amount={entry.finalCost} decimals={5} />
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Entry Date</span>
                                  <span className="font-semibold">
                                    {format(new Date(entry.entryDate), 'dd/MM/yyyy')}
                                  </span>
                                </div>

                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">CBM per CTN</span>
                                  <span className="font-semibold">{entry.cbm}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total CBM</span>
                                  <span className="font-semibold">{entry.totalCbm}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Weight per CTN</span>
                                  <span className="font-semibold">{entry.weight}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Total Weight</span>
                                  <span className="font-semibold">{entry.totalWeight}</span>
                                </div>
                              </div>
                            </div>

                            {/* Section 2 — Payment + Stock Summary */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Payment Summary */}
                              <div className="rounded-lg border bg-background p-4">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                                  Payment Summary
                                </p>
                                <div className="grid grid-cols-2 gap-y-2 text-sm">
                                  <span className="text-muted-foreground">Total Amount (¥)</span>
                                  <span className="text-right font-medium">
                                    <AmountDisplay amount={entry.totalAmount} currency="RMB" />
                                  </span>

                                  <span className="text-muted-foreground">Given Amount (¥)</span>
                                  <span className="text-right font-medium">
                                    <AmountDisplay amount={entry.givenAmount} currency="RMB" />
                                  </span>

                                  <span className="text-muted-foreground">Remaining Amount (¥)</span>
                                  <span
                                    className={
                                      entry.remainingAmount > 0
                                        ? 'text-right font-medium text-red-500'
                                        : 'text-right font-medium text-emerald-600'
                                    }
                                  >
                                    <AmountDisplay amount={entry.remainingAmount} currency="RMB" />
                                  </span>

                                  <span className="text-muted-foreground">Status</span>
                                  <span className="text-right">
                                    <StatusBadge
                                      status={
                                        entry.currentStatus as 'paid' | 'unpaid' | 'partiallypaid'
                                      }
                                    />
                                  </span>
                                </div>
                              </div>

                              {/* Stock & Cost Summary */}
                              <div className="rounded-lg border bg-emerald-50 p-4 dark:bg-emerald-950/20">
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide mb-3">
                                  Stock & Cost Summary
                                </p>
                                <div className="grid grid-cols-2 gap-y-2 text-sm">
                                  <span className="text-muted-foreground">Available CTN (India)</span>
                                  <span className={`text-right font-medium ${availableCtnClass(entry)}`}>
                                    {calculatedAvailableCtn(entry)} / {entry.totalCtn}
                                  </span>

                                  <span className="text-muted-foreground">China WH CTN</span>
                                  <span className="text-right font-medium text-amber-600">
                                    {entry.chinaWarehouseCtn ?? 0}
                                  </span>

                                  <span className="text-muted-foreground">In Transit CTN</span>
                                  <span className="text-right font-medium text-blue-600">
                                    {entry.inTransitCtn ?? 0}
                                  </span>

                                  <span className="text-muted-foreground">Sold CTN</span>
                                  <span className="text-right font-medium text-red-500">
                                    {entry.soldCtn ?? 0}
                                  </span>

                                  {(entry.inTransitCtn ?? 0) > 0 && (
                                    <div className="col-span-2 mt-3 border-t pt-3">
                                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                                        Container Breakdown
                                      </p>
                                      {entry.containers && entry.containers.length > 0 ? (
                                        <div className="space-y-1">
                                          {entry.containers.map((container) => (
                                            <div
                                              key={container._id}
                                              className="flex items-center justify-between text-sm"
                                            >
                                              <Link
                                                href={`/containers/${container._id}`}
                                                className="flex items-center gap-2 text-primary hover:underline"
                                              >
                                                <Ship className="h-3 w-3 shrink-0" />
                                                <span>{container.containerId}</span>
                                                <span className="text-muted-foreground">—</span>
                                                <span>{container.containerName}</span>
                                              </Link>
                                              <div className="flex items-center gap-3">
                                                <span className="font-medium">{container.ctnCount} CTN</span>
                                                <Badge
                                                  className={cn(
                                                    'text-xs',
                                                    container.status === 'loading' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                                                    container.status === 'in_transit' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                                                    container.status === 'customs_clearance' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                                                    container.status === 'arrived' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                                  )}
                                                >
                                                  {container.status.replace('_', ' ')}
                                                </Badge>
                                              </div>
                                            </div>
                                          ))}
                                          <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t mt-1">
                                            <span>Total loaded in containers</span>
                                            <span>
                                              {entry.containers.reduce((s, c) => s + c.ctnCount, 0)} / {entry.inTransitCtn ?? 0} CTN
                                            </span>
                                          </div>
                                          {(entry.unassignedCtn ?? 0) > 0 && (
                                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                              ⚠️ {entry.unassignedCtn} CTN not assigned to any container
                                            </p>
                                          )}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-amber-600 dark:text-amber-400">
                                          ⚠️ {entry.inTransitCtn} CTN in transit but not assigned to any container yet
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  <span className="text-muted-foreground">Total Expense INR</span>
                                  <span className="text-right font-medium">
                                    <AmountDisplay amount={entry.totalExpenseINR} />
                                  </span>

                                  <span className="text-muted-foreground">Estimated Profit</span>
                                  <span className="text-right font-medium text-muted-foreground">—</span>

                                  <span className="col-span-2 text-xs text-muted-foreground mt-1">
                                    Check: China WH + Transit + Available + Sold = Total →{' '}
                                    {(entry.chinaWarehouseCtn ?? 0) +
                                      (entry.inTransitCtn ?? 0) +
                                      calculatedAvailableCtn(entry) +
                                      (entry.soldCtn ?? 0)}{' '}
                                    / {entry.totalCtn}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Section 3 — Payment History */}
                            <div className="rounded border bg-background p-3">
                              <p className="mb-2 text-sm font-semibold">
                                Payment History
                              </p>
                              {(paymentsByEntry[entry._id]?.length ?? 0) === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No payments made yet.
                                </p>
                              ) : (
                                <>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="py-2 text-left font-medium">Date</th>
                                        <th className="py-2 text-left font-medium">Sophia Person</th>
                                        <th className="py-2 text-right font-medium">Amount (¥)</th>
                                        <th className="py-2 text-left font-medium">Notes</th>
                                        <th className="w-16" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(paymentsByEntry[entry._id] ?? []).map((p) => (
                                        <tr key={p._id} className="border-b last:border-0">
                                          <td className="py-2">
                                            {format(new Date(p.paymentDate), 'dd MMM yyyy')}
                                          </td>
                                          <td className="py-2">{p.chinaPersonName ?? '—'}</td>
                                          <td className="py-2 text-right">
                                            ¥
                                            {new Intl.NumberFormat('en-IN', {
                                              maximumFractionDigits: 0,
                                            }).format(p.amount)}
                                          </td>
                                          <td className="max-w-[200px] truncate py-2 text-muted-foreground">
                                            {p.notes ?? '—'}
                                          </td>
                                          <td className="py-2">
                                            <ConfirmDialog
                                              title="Delete payment"
                                              description="This will reverse the China person balance and recalculate entry given amount."
                                              confirmLabel="Delete"
                                              variant="destructive"
                                              onConfirm={() =>
                                                handleDeletePayment(p._id, entry._id)
                                              }
                                              trigger={
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8 text-destructive"
                                                  aria-label="Delete payment"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </Button>
                                              }
                                            />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="mt-2 flex justify-end text-sm font-medium">
                                    <span className="mr-2 text-muted-foreground">Total Paid:</span>
                                    <span>
                                      ¥
                                      {new Intl.NumberFormat('en-IN', {
                                        maximumFractionDigits: 0,
                                      }).format(
                                        (paymentsByEntry[entry._id] ?? []).reduce(
                                          (sum, p) => sum + p.amount,
                                          0
                                        )
                                      )}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
           
          </table>
          </div>
        )}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
        </div>
      )}
    </div>
  )
}
