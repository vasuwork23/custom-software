'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, LayoutGrid, List, Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
  } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<CompanyItem | null>(null)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const debouncedSearch = useDebounce(search, 400)

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const result = await apiGet<{
      companies: CompanyItem[]
      pagination: { page: number; limit: number; total: number; pages: number }
    }>(`/api/companies?${params}`)
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, debouncedSearch])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search by name, owner, city, mobile..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
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
      ) : !data?.companies.length ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Add your first company to start recording sale bills and payments."
        >
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Company
          </Button>
        </EmptyState>
      ) : view === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.companies.map((c) => (
            <Card
              key={c._id}
              className="overflow-hidden cursor-pointer"
              onClick={() => router.push(`/companies/${c._id}`)}
            >
              <CardHeader className="pb-2">
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
                    {[c.contact1Mobile, c.contact2Mobile].filter(Boolean).join(' · ')}
                  </p>
                )}
                {c.city && (
                  <p className="text-xs text-muted-foreground">{c.city}</p>
                )}
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
                <div className="flex gap-2 pt-2">
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
                      description="This cannot be undone. You cannot delete a company that has sale bills or payment receipts."
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={() => handleDelete(c)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label="Delete"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
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
              {data.companies.map((c) => (
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
                        description="This cannot be undone. You cannot delete a company that has sale bills or payment receipts."
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => handleDelete(c)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            aria-label="Delete"
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
          page={data.pagination.page}
          totalPages={data.pagination.pages}
          total={data.pagination.total}
          pageSize={data.pagination.limit}
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
