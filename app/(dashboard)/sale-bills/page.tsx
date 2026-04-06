'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Pencil, Trash2, Download } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { type DateRange } from 'react-day-picker'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { apiGet, apiDelete, authHeaders } from '@/lib/api-client'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { generateBillFileName } from '@/lib/utils'

interface BillRow {
  _id: string
  billNumber: number
  billDate: string
  company: string
  isCashbook?: boolean
  companyName: string
  totalAmount: number
  grandTotal?: number
  whatsappSent: boolean
  whatsappSentAt?: string
  itemCount?: number
  productsSummary?: string
  contact1Mobile?: string
  contact2Mobile?: string
}

export default function SellBillsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [data, setData] = useState<{
    bills: BillRow[]
    pagination: { page: number; limit: number; total: number; pages: number }
  } | null>(null)
  const debouncedSearch = useDebounce(search, 400)

  const fetchBills = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    const result = await apiGet<{ bills: BillRow[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/api/sell-bills?${params}`
    )
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, debouncedSearch, dateRange])

  useEffect(() => {
    fetchBills()
  }, [fetchBills])

  async function handleDelete(billId: string) {
    const result = await apiDelete(`/api/sell-bills/${billId}`)
    if (result.success) {
      toast.success('Bill deleted')
      fetchBills()
    } else toast.error(result.message)
  }

  async function handleDownload(b: BillRow) {
    if (downloading) return
    setDownloading(b._id)
    try {
      const res = await fetch(`/api/sell-bills/${b._id}/pdf`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Failed to download PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = generateBillFileName({
        companyName: b.companyName,
        billNumber: b.billNumber,
        billDate: b.billDate,
      })
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Bill downloaded')
    } catch (error) {
      console.error(error)
      toast.error('Failed to download bill')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sale Bills"
        description="Create and manage sale bills."
        action={
          <Button asChild>
            <Link href="/sale-bills/new">
              <Plus className="mr-2 h-4 w-4" />
              Add New Bill
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <Input
            placeholder="Search by bill number or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Date range"
          />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : !data?.bills.length ? (
        <EmptyState
          icon={FileText}
          title="No sale bills yet"
          description="Create your first sale bill to record sales and track revenue."
        >
          <Button asChild>
            <Link href="/sale-bills/new">
              <Plus className="mr-2 h-4 w-4" />
              Add New Bill
            </Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="w-full overflow-hidden rounded-md border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider">
                  <th className="h-10 px-4 text-left font-medium">Bill No</th>
                  <th className="h-10 px-4 text-left font-medium">Date</th>
                  <th className="h-10 px-4 text-left font-medium">Company</th>
                  <th className="h-10 px-4 text-left font-medium">Mobile No</th>
                  <th className="h-10 px-4 text-left font-medium">Products Summary</th>
                  <th className="h-10 px-4 text-right font-medium">Grand Total</th>
                  <th className="h-10 w-32 px-4" />
                </tr>
              </thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr 
                    key={b._id} 
                    className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/sale-bills/${b._id}`)}
                  >
                    <td className="p-4 font-medium text-emerald-600 dark:text-emerald-400">#{b.billNumber}</td>
                    <td className="p-4 whitespace-nowrap">{new Date(b.billDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="p-4">
                      {b.isCashbook ? (
                        <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
                          💵 Cashbook
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{b.companyName}</span>
                          {b.company && (
                            <span 
                              className="text-[10px] text-muted-foreground hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/companies/${b.company}`);
                              }}
                            >
                              View Company
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {b.contact1Mobile && <span>{b.contact1Mobile}</span>}
                        {b.contact2Mobile && <span>{b.contact2Mobile}</span>}
                        {!b.contact1Mobile && !b.contact2Mobile && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="p-4 text-[11px] text-muted-foreground whitespace-pre-line leading-relaxed min-w-[200px]" title={b.productsSummary}>
                      {b.productsSummary ?? (b.itemCount != null ? `${b.itemCount} product${b.itemCount !== 1 ? 's' : ''}` : '—')}
                    </td>
                    <td className="p-4 text-right font-medium">
                      <AmountDisplay amount={b.grandTotal ?? b.totalAmount} />
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          onClick={() => handleDownload(b)}
                          disabled={downloading === b._id}
                          title="Download PDF"
                        >
                          <Download className={`h-4 w-4 ${downloading === b._id ? 'animate-pulse' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <Link href={`/sale-bills/${b._id}/edit`} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <ConfirmDialog
                          title="Delete sale bill"
                          description="This will reverse FIFO and restore stock to buying entries. This cannot be undone."
                          confirmLabel="Delete"
                          variant="destructive"
                          onConfirm={() => handleDelete(b._id)}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(data?.pagination?.pages ?? 0) > 1 && data && (
        <Pagination
          page={data.pagination.page}
          totalPages={data.pagination.pages}
          total={data.pagination.total}
          pageSize={data.pagination.limit}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
