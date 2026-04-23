'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiDelete, apiGet } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface InvestmentInfo {
  _id: string
  investorName: string
  currentBalance: number
}

interface InvestmentTransactionRow {
  _id: string
  type: 'add' | 'withdraw'
  amount: number
  balanceAfter: number
  transactionDate: string
  note: string
}

interface PageData {
  investment: InvestmentInfo
  transactions: InvestmentTransactionRow[]
}

export default function InvestmentHistoryPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params.id === 'string' ? params.id : ''
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PageData | null>(null)
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<PageData>(`/api/banks/investments/${id}/transactions`)
    setLoading(false)
    if (result.success) {
      setData(result.data)
      return
    }
    toast.error(result.message)
    if (
      result.error === 'Not found' ||
      (result as { message?: string }).message?.toLowerCase().includes('not found')
    ) {
      router.push('/banks')
    }
  }, [id, router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDeleteTransaction = async (tx: InvestmentTransactionRow) => {
    if (!id) return
    setDeletingTxId(tx._id)
    try {
      const result = await apiDelete<{ newBalance: number }>(
        `/api/banks/investments/${id}/transactions/${tx._id}`
      )
      if (!result.success) {
        toast.error(result.message ?? 'Failed to delete transaction')
        return
      }
      toast.success('Transaction deleted and balances updated')
      fetchData()
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

  const { investment, transactions } = data

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
            <span>{investment.investorName}</span>
            <span
              className={cn(
                'text-lg font-semibold',
                investment.currentBalance < 0 && 'text-destructive'
              )}
            >
              <AmountDisplay amount={investment.currentBalance} />
            </span>
          </div>
        }
        description="Investment history"
      />

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-right p-3 font-medium">Amount</th>
              <th className="text-right p-3 font-medium">Balance After</th>
              <th className="text-left p-3 font-medium">Note</th>
              <th className="w-10 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx._id} className="border-b last:border-0">
                  <td className="p-3">{format(new Date(tx.transactionDate), 'dd MMM yyyy')}</td>
                  <td className="p-3 capitalize">{tx.type}</td>
                  <td className="p-3 text-right">
                    <AmountDisplay amount={tx.amount} />
                  </td>
                  <td className="p-3 text-right">
                    <AmountDisplay amount={tx.balanceAfter} />
                  </td>
                  <td className="p-3 text-muted-foreground">{tx.note || '—'}</td>
                  <td className="p-3 text-right">
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
                      title="Delete investment transaction?"
                      description={
                        `${tx.type === 'add' ? 'Add' : 'Withdraw'} ₹${tx.amount.toLocaleString('en-IN')}\n` +
                        (tx.note || '') +
                        '\n\nThis will also reverse the linked cashbook entry.'
                      }
                      onConfirm={() => handleDeleteTransaction(tx)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
