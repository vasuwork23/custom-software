'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, LayoutGrid, List, Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompanyFormSheet } from '@/components/companies/CompanyFormSheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { apiGet, apiDelete } from '@/lib/api-client'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { PaymentFormDialog } from '@/components/received-voucher/PaymentFormDialog'

type ViewMode = 'card' | 'table'
type OutstandingFilter = 'all' | 'positive' | 'negative' | 'clear'

interface CompanyItem {
  _id: string
  companyName: string
  ownerName?: string
  contact1Name?: string
  contact1Mobile?: string
  contact2Name?: string
  contact2Mobile?: string
  gstNumber?: string
  address?: string
  city?: string
  openingBalance?: number
  openingBalanceNotes?: string
  outstandingBalance: number
  totalProfit: number
}

export default function CompaniesPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('table')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    companies: CompanyItem[]
    pagination: { page: number; limit: number; total: number; pages: number }
    totals: { totalPositiveOutstanding: number; totalNegativeOutstanding: number }
  } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<CompanyItem | null>(null)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [outstandingFilter, setOutstandingFilter] = useState<OutstandingFilter>('all')
  const [minOutstanding, setMinOutstanding] = useState('')
  const [maxOutstanding, setMaxOutstanding] = useState('')
  const debouncedSearch = useDebounce(search, 400)
  const debouncedOutstandingFilter = useDebounce(outstandingFilter, 400)
  const debouncedMinOutstanding = useDebounce(minOutstanding, 400)
  const debouncedMaxOutstanding = useDebounce(maxOutstanding, 400)

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    params.set('outstandingFilter', debouncedOutstandingFilter)
    if (debouncedMinOutstanding.trim() !== '') params.set('minOutstanding', debouncedMinOutstanding)
    if (debouncedMaxOutstanding.trim() !== '') params.set('maxOutstanding', debouncedMaxOutstanding)
    const result = await apiGet<{
      companies: CompanyItem[]
      pagination: { page: number; limit: number; total: number; pages: number }
      totals: { totalPositiveOutstanding: number; totalNegativeOutstanding: number }
    }>(`/api/companies?${params}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, debouncedSearch, debouncedOutstandingFilter, debouncedMinOutstanding, debouncedMaxOutstanding])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, debouncedOutstandingFilter, debouncedMinOutstanding, debouncedMaxOutstanding])

  function openAdd() {
    setEditingCompany(null)
    setSheetOpen(true)
  }

  function openEdit(company: CompanyItem) {
    setEditingCompany(company)
    setSheetOpen(true)
  }

  async function handleDelete(company: CompanyItem) {
    const result = await apiDelete<{ deleted: string }>(`/api/companies/${company._id}`)
    if (!result.success) {
      toast.error(result.message)
      return
    }
    toast.success('Company deleted')
    fetchCompanies()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Manage customer companies and their outstanding balances."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPaymentDialogOpen(true)}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Receive Payment
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Company
            </Button>
          </div>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by name, owner, city, mobile..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:max-w-sm"
            />
            <Select
              value={outstandingFilter}
              onValueChange={(value: OutstandingFilter) => setOutstandingFilter(value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Outstanding filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outstanding</SelectItem>
                <SelectItem value="positive">Positive (To Receive)</SelectItem>
                <SelectItem value="negative">Negative (Advance/Credit)</SelectItem>
                <SelectItem value="clear">Clear (Zero)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={minOutstanding}
              onChange={(e) => setMinOutstanding(e.target.value)}
              placeholder="Min outstanding"
              className="w-full sm:w-[150px]"
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              value={maxOutstanding}
              onChange={(e) => setMaxOutstanding(e.target.value)}
              placeholder="Max outstanding"
              className="w-full sm:w-[150px]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOutstandingFilter('all')
                setMinOutstanding('')
                setMaxOutstanding('')
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Positive Outstanding (To Receive)</p>
              <p className="text-lg font-semibold text-red-600">
                <AmountDisplay amount={data?.totals?.totalPositiveOutstanding ?? 0} />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Negative Outstanding (Advance/Credit)</p>
              <p className="text-lg font-semibold text-blue-600">
                <AmountDisplay amount={data?.totals?.totalNegativeOutstanding ?? 0} />
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={view === 'card' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setView('card')}
            aria-label="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setView('table')}
            aria-label="Table view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : !(data?.companies?.length ?? 0) ? (
        <EmptyState
          icon={Building2}
          title={data?.companies?.length ? 'No companies match filters' : 'No companies yet'}
          description={
            data?.companies?.length
              ? 'Try changing outstanding filter or amount range.'
              : 'Add your first company to start recording sale bills and payments.'
          }
        >
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Company
          </Button>
        </EmptyState>
      ) : view === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.companies.map((c) => (
            <Card
              key={c._id}
              className="overflow-hidden cursor-pointer"
              onClick={() => router.push(`/companies/${c._id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/companies/${c._id}`}
                      className="font-semibold hover:underline line-clamp-1"
                    >
                      {c.companyName}
                    </Link>
                    {c.ownerName && (
                      <p className="text-sm text-muted-foreground">{c.ownerName}</p>
                    )}
                    {(c.contact1Mobile || c.contact2Mobile) && (
                      <p className="text-xs text-muted-foreground">
                        {[c.contact1Mobile, c.contact2Mobile]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {c.city && (
                      <p className="text-xs text-muted-foreground">{c.city}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(c)
                      }}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDialog
                      title="Delete company"
                      description="This cannot be undone. The company must have zero outstanding balance, and no linked sale bills or payment receipts."
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={() => handleDelete(c)}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label="Delete"
                          disabled={c.outstandingBalance !== 0}
                          title={
                            c.outstandingBalance !== 0
                              ? 'Cannot delete: company has a pending outstanding balance'
                              : 'Delete company'
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span
                    className={
                      c.outstandingBalance > 0
                        ? 'text-red-600'
                        : c.outstandingBalance === 0
                        ? 'text-green-600'
                        : 'text-blue-600'
                    }
                  >
                    {c.outstandingBalance > 0 && (
                      <AmountDisplay amount={c.outstandingBalance} />
                    )}
                    {c.outstandingBalance === 0 && 'Clear'}
                    {c.outstandingBalance < 0 && (
                      <>
                        Credit{' '}
                        <AmountDisplay amount={Math.abs(c.outstandingBalance)} />
                      </>
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Profit</span>
                  <AmountDisplay amount={c.totalProfit} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-md border">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium">Company Name</th>
                <th className="h-10 px-4 text-left font-medium">Owner Name</th>
                <th className="h-10 px-4 text-left font-medium">Mobile</th>
                <th className="h-10 px-4 text-left font-medium">City</th>
                <th className="h-10 px-4 text-right font-medium">Outstanding</th>
                <th className="h-10 px-4 text-right font-medium">Total Profit</th>
                <th className="h-10 w-24 px-4" />
              </tr>
            </thead>
            <tbody>
              {data?.companies.map((c) => (
                <tr
                  key={c._id}
                  className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                  onClick={() => router.push(`/companies/${c._id}`)}
                >
                  <td className="p-4 font-medium">{c.companyName}</td>
                  <td className="p-4 text-muted-foreground">{c.ownerName ?? '—'}</td>
                  <td className="p-4 text-muted-foreground">
                    {[c.contact1Mobile, c.contact2Mobile].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="p-4 text-muted-foreground">{c.city ?? '—'}</td>
                  <td className="p-4 text-right">
                    <span
                      className={
                        c.outstandingBalance > 0
                          ? 'text-red-600'
                          : c.outstandingBalance === 0
                          ? 'text-green-600'
                          : 'text-blue-600'
                      }
                    >
                      {c.outstandingBalance > 0 && (
                        <AmountDisplay amount={c.outstandingBalance} />
                      )}
                      {c.outstandingBalance === 0 && 'Clear'}
                      {c.outstandingBalance < 0 && (
                        <>
                          Credit{' '}
                          <AmountDisplay
                            amount={Math.abs(c.outstandingBalance)}
                          />
                        </>
                      )}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <AmountDisplay amount={c.totalProfit} />
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(c)
                        }}
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <ConfirmDialog
                        title="Delete company"
                        description="This cannot be undone. The company must have zero outstanding balance, and no linked sale bills or payment receipts."
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => handleDelete(c)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            aria-label="Delete"
                            disabled={c.outstandingBalance !== 0}
                            title={
                              c.outstandingBalance !== 0
                                ? 'Cannot delete: company has a pending outstanding balance'
                                : 'Delete company'
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
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

      {(data?.pagination?.pages ?? 0) > 1 && (
        <Pagination
          page={data?.pagination?.page ?? 1}
          totalPages={data?.pagination?.pages ?? 1}
          total={data?.pagination?.total ?? 0}
          pageSize={data?.pagination?.limit ?? 20}
          onPageChange={setPage}
        />
      )}

      <CompanyFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={fetchCompanies}
        editCompany={editingCompany}
      />
      <PaymentFormDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        onSuccess={fetchCompanies}
        editPayment={null}
      />
    </div>
  )
}
