'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import type { DateRange } from 'react-day-picker'

interface Transaction {
  _id: string
  type: 'credit' | 'debit' | 'reversal'
  amount: number
  balanceAfter: number
  reference?: string
  buyingEntry?: string
  transactionDate: string
  notes?: string
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

export function TransactionHistory({
  onRefresh,
  refreshTrigger,
}: {
  onRefresh?: () => void
  refreshTrigger?: number
}) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ transactions: Transaction[]; pagination: Pagination } | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '10')
    if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    const result = await apiGet<{ transactions: Transaction[]; pagination: Pagination }>(
      `/api/china-bank/transactions?${params}`
    )
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, dateRange?.from, dateRange?.to])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions, refreshTrigger])

  async function handleDelete(id: string) {
    const result = await apiDelete<{ deleted: string }>(`/api/china-bank/transactions/${id}`)
    if (result.success) {
      toast.success('Transaction deleted')
      fetchTransactions()
      onRefresh?.()
    } else toast.error(result.message ?? result.error)
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Transaction History</h3>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          placeholder="Filter by date range"
          className="w-full sm:w-auto"
        />
      </div>

      <div className="rounded-md border">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : data.transactions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b">
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Date</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Type</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Reference</th>
                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Balance After</th>
                  <th className="h-10 w-10 px-4" />
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((tx) => (
                  <tr key={tx._id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="p-4">{format(new Date(tx.transactionDate), 'dd MMM yyyy')}</td>
                    <td className="p-4">
                      <StatusBadge status={tx.type} />
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {tx.reference ?? tx.notes ?? '—'}
                    </td>
                    <td className="p-4 text-right">
                      <AmountDisplay
                        amount={tx.type === 'debit' ? -tx.amount : tx.amount}
                        showSign
                      />
                    </td>
                    <td className="p-4 text-right">
                      <AmountDisplay amount={tx.balanceAfter} />
                    </td>
                    <td className="p-4">
                      {tx.type === 'credit' && !tx.buyingEntry ? (
                        <ConfirmDialog
                          title="Delete transaction"
                          description="This will remove this credit entry and recalculate subsequent balances. This cannot be undone."
                          confirmLabel="Delete"
                          variant="destructive"
                          onConfirm={() => handleDelete(tx._id)}
                          trigger={
                            <Button variant="ghost" size="icon" className="text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.pages} ({data.pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
              disabled={page >= data.pagination.pages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
