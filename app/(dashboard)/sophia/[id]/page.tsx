'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { PayInOutDialog } from '@/components/jack/PayInOutDialog'
import { SophiaPayOutDialog } from '@/components/jack/SophiaPayOutDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'

interface TransactionRow {
  _id: string
  type: 'pay_in' | 'pay_out'
  amount: number
  balanceAfter: number
  transactionDate: string
  notes?: string
  sourceLabel?: string
  productId?: string
  productName?: string
  entryDate?: string
  isReversal?: boolean
}

interface PersonDetail {
  _id: string
  name: string
  isDefault: boolean
  currentBalance: number
}

interface PageData {
  person: PersonDetail
  transactions: TransactionRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export default function JackDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params.id === 'string' ? params.id : ''
  const [data, setData] = useState<PageData | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payMode, setPayMode] = useState<'pay_in' | 'pay_out'>('pay_in')

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<PageData>(`/api/sophia/${id}/transactions?page=${page}&limit=20`)
    setLoading(false)
    if (result.success) setData(result.data)
    else {
      toast.error(result.message)
      router.push('/sophia')
    }
  }, [id, page, router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleDeleteTx(tx: TransactionRow) {
    const result = await apiDelete(`/api/sophia/transactions/${tx._id}`)
    if (result.success) {
      toast.success(tx.productName ? 'Payment reversed successfully' : 'Transaction deleted')
      fetchData()
    } else toast.error(result.message)
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

  const { person, transactions, pagination } = data
  const isNegative = person.currentBalance < 0

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/sophia" className="text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Sophia
          </Link>
        }
        title={`${person.name}${person.isDefault ? ' (Default)' : ''}`}
        action={
          <div className="flex gap-2">
            <Button
              className="text-green-600 hover:text-green-700"
              onClick={() => { setPayMode('pay_in'); setPayDialogOpen(true) }}
            >
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              Pay In
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setPayMode('pay_out')
                setPayDialogOpen(true)
              }}
            >
              <ArrowUpFromLine className="mr-2 h-4 w-4" />
              Pay Out
            </Button>
          </div>
        }
      />

      <div
        className={cn(
          'rounded-lg border p-6 text-center',
          isNegative && 'border-destructive/50 bg-destructive/5'
        )}
      >
        <p className="text-sm text-muted-foreground">Current Balance (RMB ¥)</p>
        <p className={cn('text-3xl font-bold', isNegative && 'text-destructive')}>
          <AmountDisplay amount={person.currentBalance} currency="RMB" />
        </p>
        {isNegative && (
          <p className="mt-1 text-sm font-medium text-destructive">Negative balance</p>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-10 px-4 text-left font-medium">Date</th>
              <th className="h-10 px-4 text-center font-medium">Type</th>
              <th className="h-10 px-4 text-right font-medium">Amount (¥)</th>
              <th className="h-10 px-4 text-left font-medium">Product</th>
              <th className="h-10 px-4 text-left font-medium">Entry Date</th>
              <th className="h-10 px-4 text-right font-medium">Balance After (¥)</th>
              <th className="h-10 px-4 text-left font-medium">Notes</th>
              <th className="h-10 w-20 px-4" />
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t._id} className="border-b last:border-0">
                  <td className="p-4">{format(new Date(t.transactionDate), 'dd MMM yyyy')}</td>
                  <td className="p-4 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
                        t.type === 'pay_in' && 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
                        t.type === 'pay_out' && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      )}
                    >
                      {t.type === 'pay_in' ? 'Pay In' : 'Pay Out'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <AmountDisplay
                      amount={t.type === 'pay_in' ? t.amount : -t.amount}
                      currency="RMB"
                      showSign
                    />
                  </td>
                  <td className="p-4">
                    {t.productId && t.productName ? (
                      <Link
                        href={`/products/${t.productId}`}
                        className="text-primary hover:underline"
                      >
                        {t.productName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-4 text-muted-foreground">
                    {t.entryDate ? format(new Date(t.entryDate), 'dd MMM yyyy') : '—'}
                  </td>
                  <td className="p-4 text-right">
                    <AmountDisplay amount={t.balanceAfter} currency="RMB" />
                  </td>
                  <td className="p-4 text-muted-foreground max-w-[200px] truncate" title={t.sourceLabel ?? t.notes}>
                    {t.sourceLabel ?? t.notes ?? '—'}
                  </td>
                  <td className="p-4">
                    {(t.isReversal || /^Reversal\b/i.test(t.sourceLabel ?? '') || /\bReversal\b/i.test(t.notes ?? '')) ? (
                      <span className="text-xs text-muted-foreground italic">auto-generated</span>
                    ) : (
                      <ConfirmDialog
                        title="Delete transaction"
                        description={
                          t.type === 'pay_out' && t.productName
                            ? `This will reverse ¥${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(t.amount)} payment for ${t.productName}. Continue?`
                            : 'This will reverse the balance impact and recalculate subsequent transactions.'
                        }
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => handleDeleteTx(t)}
                        trigger={
                          <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
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
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
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

      {payMode === 'pay_in' && (
        <PayInOutDialog
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={fetchData}
          personId={id}
          personName={person.name}
          mode="pay_in"
        />
      )}
      {payMode === 'pay_out' && (
        <SophiaPayOutDialog
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={fetchData}
          personId={id}
          personName={person.name}
        />
      )}
    </div>
  )
}
