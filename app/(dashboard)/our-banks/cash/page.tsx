'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Trash2, FileDown } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import type { DateRange } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/hooks/useDebounce'
import { ExportPdfButton } from '@/components/ui/ExportPdfButton'
import { exportTableToPdf } from '@/lib/exportPdf'

interface CashTransactionRow {
  _id: string
  type: 'credit' | 'debit'
  amount: number
  description: string
  date: string
  category: string
  runningBalance: number
  isReversal?: boolean
}

interface CashHistoryData {
  transactions: CashTransactionRow[]
  total: number
  currentBalance: number
  page: number
  totalPages: number
}

export default function CashHistoryPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<CashHistoryData | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit'>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 400)
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null)
  const [exportingAll, setExportingAll] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '50')
    if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)

    const result = await apiGet<CashHistoryData>(`/api/our-banks/cash/transactions?${params.toString()}`)
    setLoading(false)
    if (result.success) {
      setData(result.data)
    } else {
      toast.error(result.message ?? 'Failed to load cash transactions')
    }
  }, [page, dateRange?.from, dateRange?.to, typeFilter, debouncedSearch])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDeleteCashTransaction = async (tx: CashTransactionRow) => {
    setDeletingTxId(tx._id)
    try {
      const result = await apiDelete<{ newBalance: number | null }>(
        `/api/our-banks/cash/transactions/${tx._id}`
      )
      if (result.success) {
        toast.success('Transaction deleted and cash balance updated')
        fetchData()
      } else {
        toast.error(result.message ?? 'Failed to delete transaction')
      }
    } finally {
      setDeletingTxId(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (!data) return null

  const { transactions, currentBalance, page: currentPage, totalPages, total } = data
  const isNegative = currentBalance < 0

  const isDeletable = (tx: CashTransactionRow) =>
    tx.category === 'cash_in' || tx.description.startsWith('Withdraw Cash')

  const pdfColumns = [
    'Date',
    'Description',
    'Category',
    'Debit (₹)',
    'Credit (₹)',
    'Balance (₹)',
  ]

  const mapRows = (rows: CashTransactionRow[]) =>
    rows.map((tx) => [
      format(new Date(tx.date), 'dd MMM yyyy'),
      tx.description,
      tx.category.replace(/_/g, ' '),
      tx.type === 'debit' ? tx.amount : '',
      tx.type === 'credit' ? tx.amount : '',
      tx.runningBalance,
    ])

  async function handleExportAll() {
    try {
      setExportingAll(true)
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', '50')
      params.set('exportAll', '1')
      if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
      if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)

      const result = await apiGet<CashHistoryData>(
        `/api/our-banks/cash/transactions?${params.toString()}`
      )
      if (!result.success) {
        toast.error(result.message ?? 'Failed to export cash transactions')
        return
      }
      if (!result.data.transactions.length) {
        toast.info('No cash transactions to export')
        return
      }
      exportTableToPdf({
        title: 'Cash Transactions',
        columns: pdfColumns,
        rows: mapRows(result.data.transactions),
        landscape: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed'
      toast.error(message)
    } finally {
      setExportingAll(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Transaction History"
        description="Detailed ledger of all cash movements."
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <p className={cn('text-lg font-semibold', isNegative && 'text-destructive')}>
            Current balance:{' '}
            <span>
              <AmountDisplay amount={currentBalance} />
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Filter by date range"
            className="w-full sm:w-auto"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant={typeFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('all')}
            >
              All
            </Button>
            <Button
              type="button"
              variant={typeFilter === 'credit' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('credit')}
            >
              Credit
            </Button>
            <Button
              type="button"
              variant={typeFilter === 'debit' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter('debit')}
            >
              Debit
            </Button>
          </div>
          <Input
            placeholder="Search description/category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <ExportPdfButton
            title="Cash Transactions"
            landscape
            columns={pdfColumns}
            rows={mapRows(transactions)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={exportingAll}
            onClick={handleExportAll}
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            {exportingAll ? 'Exporting...' : 'Export All'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-left p-3 font-medium">Category</th>
              <th className="text-right p-3 font-medium text-red-600 dark:text-red-400">
                Debit (₹)
              </th>
              <th className="text-right p-3 font-medium text-green-600 dark:text-green-400">
                Credit (₹)
              </th>
              <th className="text-right p-3 font-medium">Balance (₹)</th>
              <th className="w-10 p-3" />
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-8 text-center text-muted-foreground"
                >
                  No cash transactions in this period.
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx._id} className="border-b last:border-0">
                  <td className="p-3">
                    {format(new Date(tx.date), 'dd MMM yyyy')}
                  </td>
                  <td className="p-3">
                    {tx.description}
                    {tx.isReversal && (
                      <span className="block text-xs text-muted-foreground">
                        (reversal)
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex rounded-full border px-2 py-0.5 text-xs capitalize">
                      {tx.category.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-right text-red-600 dark:text-red-400">
                    {tx.type === 'debit' ? (
                      <AmountDisplay amount={tx.amount} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 text-right text-green-600 dark:text-green-400">
                    {tx.type === 'credit' ? (
                      <AmountDisplay amount={tx.amount} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={cn(
                      'p-3 text-right font-medium',
                      tx.runningBalance >= 0
                        ? 'text-foreground'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    <AmountDisplay amount={tx.runningBalance} />
                  </td>
                  <td className="p-3 text-right">
                    {isDeletable(tx) && (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            disabled={deletingTxId === tx._id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                        title="Delete transaction?"
                        description={
                          `${tx.type === 'credit' ? 'Credit' : 'Debit'} ₹${tx.amount.toLocaleString(
                            'en-IN'
                          )}\n` +
                          `${tx.description}\n\n` +
                          'This will reverse the amount from cash balance.'
                        }
                        onConfirm={() => handleDeleteCashTransaction(tx)}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
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

