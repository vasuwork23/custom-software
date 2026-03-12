'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PaymentFormDialog, type PaymentFormValues } from '@/components/received-voucher/PaymentFormDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { cn } from '@/lib/utils'
import { Receipt } from 'lucide-react'
import type { DateRange } from 'react-day-picker'

interface PaymentRow {
  _id: string
  paymentDate: string
  amount: number
  paymentMode: 'cash' | 'online'
  companyId: string
  companyName: string
  bankAccountId?: string
  bankAccountName?: string
  remark?: string
}

interface PaymentsData {
  payments: PaymentRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { today: number; thisMonth: number }
}

export default function ReceivedVoucherPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PaymentsData | null>(null)
  const [companyFilter, setCompanyFilter] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | 'cash' | 'online'>('all')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<PaymentFormValues | null>(null)
  const [companyOptions, setCompanyOptions] = useState<SearchableSelectOption<string>[]>([])

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (companyFilter) params.set('companyId', companyFilter)
    if (modeFilter !== 'all') params.set('paymentMode', modeFilter)
    if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().slice(0, 10))
    if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().slice(0, 10))
    const result = await apiGet<PaymentsData>(`/api/received-voucher?${params}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, companyFilter, modeFilter, dateRange?.from, dateRange?.to])

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: { _id: string; companyName: string }[] }>('/api/companies?limit=500')
    if (res.success) setCompanyOptions(res.data.companies.map((c) => ({ value: c._id, label: c.companyName })))
  }, [])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  function openAdd() {
    setEditingPayment(null)
    setDialogOpen(true)
  }

  async function openEdit(row: PaymentRow) {
    const result = await apiGet<PaymentFormValues>(`/api/received-voucher/${row._id}`)
    if (result.success) {
      setEditingPayment(result.data)
      setDialogOpen(true)
    } else toast.error(result.message)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingPayment(null)
  }

  async function handleDelete(id: string) {
    const result = await apiDelete(`/api/received-voucher/${id}`)
    if (result.success) {
      toast.success('Voucher deleted')
      fetchPayments()
    } else toast.error(result.message)
  }

  const payments = data?.payments ?? []
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, pages: 0 }
  const summary = data?.summary ?? { today: 0, thisMonth: 0 }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receive Voucher"
        description="Record and manage received vouchers from companies."
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Voucher
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Received Today</p>
            <p className="text-2xl font-semibold">
              <AmountDisplay amount={summary.today} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Received This Month</p>
            <p className="text-2xl font-semibold">
              <AmountDisplay amount={summary.thisMonth} />
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-wrap">
        <div className="flex flex-wrap items-center gap-4">
          <SearchableSelect
            options={[{ value: '', label: 'All companies' }, ...companyOptions]}
            value={companyFilter}
            onValueChange={setCompanyFilter}
            placeholder="Company"
            className="w-[200px]"
          />
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as 'all' | 'cash' | 'online')}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="all">All modes</option>
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
          <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Date range" />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : !payments.length ? (
        <EmptyState
          icon={Receipt}
          title="No vouchers found"
          description={data ? 'No vouchers match the current filters. Try adjusting filters or add a new voucher.' : 'Could not load vouchers. Please try again.'}
        >
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Voucher
          </Button>
        </EmptyState>
      ) : (
        <>
        <div className="w-full overflow-hidden rounded-md border">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium">Date</th>
                <th className="h-10 px-4 text-left font-medium">Company Name</th>
                <th className="h-10 px-4 text-right font-medium">Amount (₹)</th>
                <th className="h-10 px-4 text-center font-medium">Mode</th>
                <th className="h-10 px-4 text-left font-medium">Bank Account</th>
                <th className="h-10 px-4 text-left font-medium">Remark</th>
                <th className="h-10 w-28 px-4" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p._id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4">{format(new Date(p.paymentDate), 'dd MMM yyyy')}</td>
                  <td className="p-4">
                    <Link href={`/companies/${p.companyId}`} className="text-primary hover:underline">
                      {p.companyName}
                    </Link>
                  </td>
                  <td className="p-4 text-right">
                    <AmountDisplay amount={p.amount} />
                  </td>
                  <td className="p-4 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        p.paymentMode === 'cash'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      )}
                    >
                      {p.paymentMode === 'cash' ? 'Cash' : 'Online'}
                    </span>
                  </td>
                  <td className="p-4 text-muted-foreground">
                    {p.paymentMode === 'online' && p.bankAccountName
                      ? p.bankAccountName
                      : p.paymentMode === 'cash'
                        ? 'Cash'
                        : '—'}
                  </td>
                  <td className="p-4 text-muted-foreground max-w-[180px] truncate">{p.remark ?? '—'}</td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <ConfirmDialog
                        title="Delete voucher"
                        description="This will reverse the bank transaction. This cannot be undone."
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => handleDelete(p._id)}
                        trigger={
                          <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete">
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
      {pagination.pages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.pages}
          total={pagination.total}
          pageSize={pagination.limit}
          onPageChange={setPage}
        />
      )}
        </>
      )}

      <PaymentFormDialog
        open={dialogOpen}
        onOpenChange={(open) => !open && closeDialog()}
        onSuccess={() => { fetchPayments(); closeDialog() }}
        editPayment={editingPayment}
      />
    </div>
  )
}
