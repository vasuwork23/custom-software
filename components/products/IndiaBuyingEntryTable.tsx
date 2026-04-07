'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export interface IndiaBuyingEntryRow {
  _id: string
  entryDate: string
  totalCtn: number
  qty: number
  rate: number
  totalQty: number
  totalAmount: number
  finalCost: number
  givenAmount: number
  remainingAmount: number
  currentStatus: string
  hasAdvancePayment?: boolean
  advanceAmount?: number
  advanceBankAccount?: string
  advanceDate?: string
  advanceNote?: string
  availableCtn: number
}

interface IndiaBuyingEntryTableProps {
  productId: string
  onRefresh: () => void
  onEdit: (entry: IndiaBuyingEntryRow) => void
  onAdd: () => void
  onMakePayment?: () => void
}

export function IndiaBuyingEntryTable({
  productId,
  onRefresh,
  onEdit,
  onAdd,
  onMakePayment,
}: IndiaBuyingEntryTableProps) {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<IndiaBuyingEntryRow[]>([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)
  const [paymentsByEntry, setPaymentsByEntry] = useState<
    Record<string, { _id: string; amount: number; paymentDate: string; bankAccountName?: string; notes?: string }[]>
  >({})
  const [paymentsLoading, setPaymentsLoading] = useState<string | null>(null)

  function stockBadge(entry: IndiaBuyingEntryRow) {
    const soldCtn = entry.totalCtn - (entry.availableCtn ?? entry.totalCtn)
    if (soldCtn === 0)
      return (
        <Badge variant="outline" className="border-green-600 text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-300 dark:border-green-700">
          Available
        </Badge>
      )
    if (entry.availableCtn === 0)
      return (
        <Badge variant="outline" className="border-red-600 text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-300 dark:border-red-700">
          Fully Sold
        </Badge>
      )
    return (
      <Badge variant="outline" className="border-amber-600 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700">
        Partially Sold
      </Badge>
    )
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const result = await apiGet<{
      entries: IndiaBuyingEntryRow[]
      pagination: { page: number; pages: number; total: number }
    }>(`/api/india-buying-entries?productId=${productId}&limit=20`)
    setLoading(false)
    if (result.success) {
      setEntries(result.data.entries)
      setPagination(result.data.pagination)
    } else toast.error(result.message)
  }, [productId])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  async function fetchPaymentsForEntry(entryId: string) {
    setPaymentsLoading(entryId)
    const result = await apiGet<{
      payments: { _id: string; amount: number; paymentDate: string; bankAccountName?: string; notes?: string }[]
    }>(`/api/india-buying-payments?buyingEntryId=${entryId}`)
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
    const result = await apiDelete(`/api/india-buying-payments/${paymentId}`)
    if (result.success) {
      toast.success('Payment deleted')
      setPaymentsByEntry((prev) => ({ ...prev, [entryId]: (prev[entryId] ?? []).filter((p) => p._id !== paymentId) }))
      fetchEntries()
      onRefresh()
    } else toast.error(result.message ?? result.error)
  }

  async function handleDelete(entryId: string) {
    const result = await apiDelete(`/api/india-buying-entries/${entryId}`)
    if (result.success) {
      toast.success('Entry deleted')
      fetchEntries()
      onRefresh()
    } else toast.error(result.message ?? result.error)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        {onMakePayment && (
          <Button variant="outline" onClick={onMakePayment}>
            Make Payment
          </Button>
        )}
        <Button onClick={onAdd}>Add Buying Entry</Button>
      </div>
      <div className="rounded-md border overflow-x-auto">
        {entries.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No buying entries. Add one to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 w-10 px-2" />
                <th className="h-10 px-4 text-left font-medium">Date</th>
                <th className="h-10 px-4 text-right font-medium">CTN</th>
                <th className="h-10 px-4 text-center font-medium">Stock</th>
                <th className="h-10 px-4 text-right font-medium">QTY/Pcs</th>
                <th className="h-10 px-4 text-right font-medium">Rate (₹)</th>
                <th className="h-10 px-4 text-right font-medium">Total (₹)</th>
                <th className="h-10 px-4 text-right font-medium">Given (₹)</th>
                <th className="h-10 px-4 text-right font-medium">Remaining (₹)</th>
                <th className="h-10 px-4 text-center font-medium">Status</th>
                <th className="h-10 w-24 px-4" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
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
                    <td className="p-4">{format(new Date(entry.entryDate), 'dd MMM yyyy')}</td>
                    <td className="p-4 text-right">{entry.totalCtn}</td>
                    <td className="p-4 text-center">{stockBadge(entry)}</td>
                    <td className="p-4 text-right">{entry.totalQty}</td>
                    <td className="p-4 text-right">₹{new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(entry.rate)}</td>
                    <td className="p-4 text-right">₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(entry.totalAmount)}</td>
                    <td className="p-4 text-right">₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(entry.givenAmount)}</td>
                    <td className="p-4 text-right">₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(entry.remainingAmount)}</td>
                    <td className="p-4 text-center">
                      <StatusBadge status={entry.currentStatus as 'paid' | 'unpaid' | 'partiallypaid'} />
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(entry)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDialog
                          title="Delete buying entry"
                          description="This cannot be undone. You cannot delete if sales exist against this entry."
                          confirmLabel="Delete"
                          variant="destructive"
                          onConfirm={() => handleDelete(entry._id)}
                          trigger={
                            <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                  {expandedEntryId === entry._id && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={11} className="p-4">
                        {paymentsLoading === entry._id ? (
                          <div className="flex justify-center py-4">
                            <LoadingSpinner size="sm" />
                          </div>
                        ) : (
                          <div className="rounded border bg-background p-3">
                            <p className="mb-2 text-sm font-medium text-muted-foreground">Payment history</p>
                            {(paymentsByEntry[entry._id]?.length ?? 0) === 0 ? (
                              <p className="text-sm text-muted-foreground">No payments yet.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 font-medium">Date</th>
                                    <th className="text-left py-2 font-medium">Bank Account</th>
                                    <th className="text-right py-2 font-medium">Amount (₹)</th>
                                    <th className="text-left py-2 font-medium">Notes</th>
                                    <th className="w-16" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {(paymentsByEntry[entry._id] ?? []).map((p) => (
                                    <tr key={p._id} className="border-b last:border-0">
                                      <td className="py-2">{format(new Date(p.paymentDate), 'dd MMM yyyy')}</td>
                                      <td className="py-2">{p.bankAccountName ?? '—'}</td>
                                      <td className="py-2 text-right">₹{new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(p.amount)}</td>
                                      <td className="py-2 text-muted-foreground max-w-[200px] truncate">{p.notes ?? '—'}</td>
                                      <td className="py-2">
                                        <ConfirmDialog
                                          title="Delete payment"
                                          description="This will reverse the bank transaction and recalculate entry given amount."
                                          confirmLabel="Delete"
                                          variant="destructive"
                                          onConfirm={() => handleDeletePayment(p._id, entry._id)}
                                          trigger={
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete payment">
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          }
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
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
