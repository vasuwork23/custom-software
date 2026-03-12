'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import type { DateRange } from 'react-day-picker'
import { cn } from '@/lib/utils'

interface BankTransactionRow {
  _id: string
  type: 'credit' | 'debit'
  amount: number
  balanceAfter: number
  runningBalance?: number
  source: string
  sourceLabel?: string
  transactionDate: string
  notes?: string
}

interface AccountInfo {
  _id: string
  accountName: string
  currentBalance: number
}

interface PageData {
  account: AccountInfo
  transactions: BankTransactionRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export default function BankAccountHistoryPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params.id === 'string' ? params.id : ''
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PageData | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 400)
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    if (debouncedSearch) params.set('search', debouncedSearch)
    const result = await apiGet<PageData>(`/api/banks/${id}/transactions?${params}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else {
      toast.error(result.message)
      if (result.error === 'Not found' || (result as { message?: string }).message?.toLowerCase().includes('not found'))
        router.push('/banks')
    }
  }, [id, page, dateRange?.from, dateRange?.to, debouncedSearch, router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDeleteTransaction = async (tx: BankTransactionRow) => {
    setDeletingTxId(tx._id)
    try {
      const result = await apiDelete<{ newBalance: number }>(
        `/api/banks/${id}/transactions/${tx._id}`
      )
      if (result.success) {
        toast.success('Transaction deleted and balance updated')
        fetchData()
      } else {
        toast.error(result.message ?? 'Failed to delete')
      }
    } finally {
      setDeletingTxId(null)
    }
  }

  if (!id) return null

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (!data) return null

  const { account, transactions, pagination } = data
  const isNegative = account.currentBalance < 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/banks">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span>{account.accountName}</span>
            <span className={cn('text-lg font-semibold', isNegative && 'text-destructive')}>
              <AmountDisplay amount={account.currentBalance} />
            </span>
          </div>
        }
        description="Transaction history"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          placeholder="Filter by date range"
          className="w-full sm:w-auto"
        />
        <Input
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-right p-3 font-medium text-red-600 dark:text-red-400">Debit (₹)</th>
              <th className="text-right p-3 font-medium text-green-600 dark:text-green-400">Credit (₹)</th>
              <th className="text-right p-3 font-medium">Balance (₹)</th>
              <th className="w-10 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No transactions in this period.
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t._id} className="border-b last:border-0">
                  <td className="p-3">{format(new Date(t.transactionDate), 'dd MMM yyyy')}</td>
                  <td className="p-3" title={t.notes ?? undefined}>
                    {t.sourceLabel ?? t.source}
                    {t.notes ? (
                      <span className="text-muted-foreground block truncate max-w-[200px]">{t.notes}</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-right text-red-600 dark:text-red-400">
                    {t.type === 'debit' ? <AmountDisplay amount={t.amount} /> : '—'}
                  </td>
                  <td className="p-3 text-right text-green-600 dark:text-green-400">
                    {t.type === 'credit' ? <AmountDisplay amount={t.amount} /> : '—'}
                  </td>
                  <td
                    className={cn(
                      'p-3 text-right font-medium',
                      (t.runningBalance ?? t.balanceAfter) >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    <AmountDisplay amount={t.runningBalance ?? t.balanceAfter} />
                  </td>
                  <td className="p-3 text-right">
                    {t.source === 'manual_add' && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            disabled={deletingTxId === t._id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                        title="Delete transaction?"
                        description={
                          `${t.type === 'credit' ? 'Credit' : 'Debit'} ₹${t.amount.toLocaleString('en-IN')}\n` +
                          (t.notes || t.sourceLabel || '') +
                          '\n\nThis will reverse the amount from the bank balance.'
                        }
                        onConfirm={() => handleDeleteTransaction(t)}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
