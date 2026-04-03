'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExpenseFormDialog, type ExpenseFormValues } from '@/components/expenses/ExpenseFormDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Receipt } from 'lucide-react'
import type { DateRange } from 'react-day-picker'

interface ExpenseRow {
  _id: string
  title: string
  amount: number
  expenseDate: string
  remark?: string
  paidFromId: string
  paidFromName: string
}

interface ExpensesData {
  expenses: ExpenseRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { today: number; thisMonth: number; thisYear: number }
}

export default function ExpensesPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ExpensesData | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [paidFromFilter, setPaidFromFilter] = useState('')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ExpenseFormValues | null>(null)
  const [accountOptions, setAccountOptions] = useState<SearchableSelectOption<string>[]>([])

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'))
    if (paidFromFilter) params.set('paidFrom', paidFromFilter)
    const result = await apiGet<ExpensesData>(`/api/expenses?${params}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, dateRange?.from, dateRange?.to, paidFromFilter])

  const fetchAccounts = useCallback(async () => {
    const res = await apiGet<{ accounts: { _id: string; accountName: string }[] }>('/api/banks')
    if (res.success)
      setAccountOptions([{ value: '', label: 'All accounts' }, ...res.data.accounts.map((a) => ({ value: a._id, label: a.accountName }))])
  }, [])

  useEffect(() => {
    fetchExpenses()
  }, [fetchExpenses])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  function openAdd() {
    setEditingExpense(null)
    setDialogOpen(true)
  }

  async function openEdit(row: ExpenseRow) {
    const result = await apiGet<ExpenseFormValues>(`/api/expenses/${row._id}`)
    if (result.success) {
      setEditingExpense(result.data)
      setDialogOpen(true)
    } else toast.error(result.message)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingExpense(null)
  }

  async function handleDelete(id: string) {
    const result = await apiDelete(`/api/expenses/${id}`)
    if (result.success) {
      toast.success('Expense deleted')
      fetchExpenses()
    } else toast.error(result.message)
  }

  const expenses = data?.expenses ?? []
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, pages: 0 }
  const summary = data?.summary ?? { today: 0, thisMonth: 0, thisYear: 0 }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track expenses by account."
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Expense
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Expenses Today</p>
            <p className="text-2xl font-semibold">
              <AmountDisplay amount={summary.today} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Expenses This Month</p>
            <p className="text-2xl font-semibold">
              <AmountDisplay amount={summary.thisMonth} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Expenses This Year</p>
            <p className="text-2xl font-semibold">
              <AmountDisplay amount={summary.thisYear} />
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center flex-wrap">
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Date range" />
          <SearchableSelect
            options={accountOptions}
            value={paidFromFilter}
            onValueChange={setPaidFromFilter}
            placeholder="Paid from account"
            className="w-[200px]"
          />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : !expenses.length ? (
        <EmptyState
          icon={Receipt}
          title="No expenses found"
          description={data ? 'No expenses match the current filters. Try adjusting filters or add a new expense.' : 'Could not load expenses. Please try again.'}
        >
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Expense
          </Button>
        </EmptyState>
      ) : (
        <div className="w-full overflow-hidden rounded-md border">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium">Date</th>
                <th className="h-10 px-4 text-left font-medium">Title</th>
                <th className="h-10 px-4 text-right font-medium">Amount (₹)</th>
                <th className="h-10 px-4 text-left font-medium">Paid From</th>
                <th className="h-10 px-4 text-left font-medium">Remark</th>
                <th className="h-10 w-28 px-4" />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e._id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4">{format(new Date(e.expenseDate), 'dd MMM yyyy')}</td>
                  <td className="p-4 font-medium">{e.title}</td>
                  <td className="p-4 text-right">
                    <AmountDisplay amount={e.amount} />
                  </td>
                  <td className="p-4 text-muted-foreground">{e.paidFromName}</td>
                  <td className="p-4 text-muted-foreground max-w-[180px] truncate">{e.remark ?? '—'}</td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(e)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <ConfirmDialog
                        title="Delete expense"
                        description="This will reverse the bank transaction. This cannot be undone."
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => handleDelete(e._id)}
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
      )}

      {pagination.pages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.pages}
          total={pagination.total}
          pageSize={pagination.limit}
          onPageChange={setPage}
        />
      )}

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={(open) => !open && closeDialog()}
        onSuccess={() => { fetchExpenses(); closeDialog() }}
        editExpense={editingExpense}
      />
    </div>
  )
}
