'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { DateRange } from 'react-day-picker'
import { PageHeader } from '@/components/ui/PageHeader'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { CarryingBillCard } from '@/components/carrying/CarryingBillCard'
import { CarryingBillSheet } from '@/components/carrying/CarryingBillSheet'
import type { CarryingBill } from '@/lib/carrying-types'
import { apiGet, apiPost, apiDelete } from '@/lib/api-client'
import { useDebounce } from '@/hooks/useDebounce'
import { Plus } from 'lucide-react'

interface CarryingListResponse {
  bills: (CarryingBill & {
    totalCBM: number
    totalAmount: number
    totalProfit: number
  })[]
  totals: {
    totalCBM: number
    totalAmount: number
    totalProfit: number
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export default function CarryingPage() {
  const [bills, setBills] = useState<CarryingListResponse['bills']>([])
  const [totals, setTotals] = useState<CarryingListResponse['totals']>({
    totalCBM: 0,
    totalAmount: 0,
    totalProfit: 0,
  })
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingBill, setEditingBill] = useState<CarryingBill | null>(null)
  const [viewingBill, setViewingBill] = useState<CarryingBill | null>(null)
  const [isPending, startTransition] = useTransition()

  const debouncedSearch = useDebounce(search, 400)
  const debouncedRange = useDebounce(dateRange, 400)

  const fetchBills = useCallback(
    (overrideSearch?: string, overrideRange?: DateRange | undefined) => {
      const s = overrideSearch ?? debouncedSearch
      const r = overrideRange ?? debouncedRange
      startTransition(async () => {
        const params = new URLSearchParams()
        if (s.trim()) params.set('search', s.trim())
        if (r?.from) params.set('from', format(r.from, 'yyyy-MM-dd'))
        if (r?.to) params.set('to', format(r.to, 'yyyy-MM-dd'))

        const res = await apiGet<CarryingListResponse>(`/api/carrying?${params.toString()}`)
        if (res.success) {
          setBills(res.data.bills)
          setTotals(res.data.totals)
        }
      })
    },
    [debouncedSearch, debouncedRange, startTransition]
  )

  useEffect(() => {
    fetchBills()
  }, [debouncedSearch, debouncedRange, fetchBills])

  const handleAddNew = () => {
    setEditingBill(null)
    setViewingBill(null)
    setSheetOpen(true)
  }

  const handleView = (bill: CarryingBill) => {
    setViewingBill(bill)
    setEditingBill(null)
    setSheetOpen(true)
  }

  const handleEdit = (bill: CarryingBill) => {
    setEditingBill(bill)
    setViewingBill(null)
    setSheetOpen(true)
  }

  const handleDelete = async (id: string) => {
    const res = await apiDelete<boolean>(`/api/carrying/${id}`)
    if (res.success) fetchBills()
  }

  const handleSave = async (bill: CarryingBill) => {
    const res = await apiPost<CarryingBill>('/api/carrying', bill)
    if (res.success) {
      setSheetOpen(false)
      setEditingBill(null)
      setViewingBill(null)
      fetchBills()
    }
  }

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      setViewingBill(null)
      setEditingBill(null)
    }
    setSheetOpen(open)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carrying"
        description="Manage carrying / logistics sell bills"
        action={
          <Button onClick={handleAddNew}>
            <Plus className="mr-2 h-4 w-4" />
            Add New Bill
          </Button>
        }
      />

      <div className="flex flex-col gap-2 rounded-md border bg-card p-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <Input
            className="h-9 text-sm"
            placeholder="Search by container or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Date range"
          />
        </div>
        <div className="flex items-center gap-2 pt-1 md:pt-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const emptyRange: DateRange | undefined = undefined
              setSearch('')
              setDateRange(emptyRange)
              fetchBills('', emptyRange)
            }}
            disabled={isPending}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
        <span className="rounded-full border bg-card px-3 py-1">
          <span className="text-muted-foreground">Total CBM: </span>
          <span className="font-medium">{formatMoney(totals.totalCBM)}</span>
        </span>
        <span className="rounded-full border bg-card px-3 py-1">
          <span className="text-muted-foreground">Total Amount: </span>
          <span className="font-medium">₹{formatMoney(totals.totalAmount)}</span>
        </span>
        <span className="rounded-full border bg-card px-3 py-1">
          <span className="text-muted-foreground">Total Profit: </span>
          <span
            className={`font-medium ${
              totals.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            ₹{formatMoney(totals.totalProfit)}
          </span>
        </span>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No bills found for current filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bills.map((bill) => (
            <CarryingBillCard
              key={bill.id}
              bill={bill}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <CarryingBillSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        bill={viewingBill ?? editingBill}
        mode={viewingBill ? 'view' : editingBill ? 'edit' : 'create'}
        onSave={handleSave}
      />
    </div>
  )
}
