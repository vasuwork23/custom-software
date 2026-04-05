'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, Plus, Trash2, Building2, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn, calcGrandTotal } from '@/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyOption {
  _id: string
  companyName: string
}

interface ProductOption {
  value: string        // "china:<id>" | "india:<id>"
  label: string        // display name with flag
  availableCtn: number
  availablePcs: number
  qtyPerCtn: number
}

interface LineRow {
  id: string
  productSource: 'china' | 'india'
  productId: string
  productName: string
  availableCtn: number
  ctnSold: number
  qtyPerCtn: number
  pcsSold: number
  ratePerPcs: number
  lineTotal: number
}

// ─── Quick-Add Company Dialog ─────────────────────────────────────────────────

function QuickAddCompanyDialog({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string
  onCreated: (company: { _id: string; companyName: string }) => void
  onClose: () => void
}) {
  const [companyName, setCompanyName] = useState(initialName)
  const [mobile, setMobile] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!companyName.trim()) return
    setLoading(true)
    const res = await apiPost<{ _id: string; companyName: string }>('/api/companies', {
      companyName: companyName.trim(),
      primaryMobile: mobile.trim() || undefined,
    })
    setLoading(false)
    if (!res.success) {
      toast.error(res.message ?? 'Failed to create company')
      return
    }
    toast.success(`Company "${res.data.companyName}" created`)
    onCreated(res.data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl space-y-4">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-base">Add New Company</h3>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Company Name *</Label>
            <Input
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Raj Traders"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mobile (optional)</Label>
            <Input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="e.g. 9876543210"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleCreate} disabled={loading || !companyName.trim()}>
            {loading ? 'Creating...' : 'Create Company'}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Company Searchable Select (with "Add Company" fallback) ──────────────────

function CompanySelect({
  options,
  value,
  onValueChange,
  onRequestAdd,
}: {
  options: CompanyOption[]
  value: string
  onValueChange: (v: string) => void
  onRequestAdd: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const cashbookOpt = { _id: 'cashbook', companyName: '💵 Cashbook — Local buyer, direct cash payment' }
  const allOptions = [cashbookOpt, ...options]

  const filtered = search.trim()
    ? allOptions.filter((c) =>
        c.companyName.toLowerCase().includes(search.toLowerCase())
      )
    : allOptions

  const selected = allOptions.find((c) => c._id === value)
  const showAddOption = search.trim().length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected?.companyName ?? 'Select company or Cashbook'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search companies..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 && !showAddOption && (
              <CommandEmpty>No company found.</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c._id}
                  value={c._id}
                  onSelect={() => {
                    onValueChange(c._id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === c._id ? 'opacity-100' : 'opacity-0')}
                  />
                  {c.companyName}
                </CommandItem>
              ))}
              {showAddOption && (
                <CommandItem
                  key="__add_company__"
                  value="__add_company__"
                  onSelect={() => {
                    setOpen(false)
                    onRequestAdd(search.trim())
                    setSearch('')
                  }}
                  className="text-primary font-medium border-t mt-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add &quot;{search.trim()}&quot; as new company
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Product Searchable Select (with available qty) ───────────────────────────

function ProductSelect({
  options,
  value,
  onValueChange,
}: {
  options: ProductOption[]
  value: string
  onValueChange: (v: string, label: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const selected = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-w-[200px]"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? 'Select product'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
        align="start"
        // Fixed height prevents the dropdown from jumping
        style={{ maxHeight: '320px', overflowY: 'auto' }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search products..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList style={{ maxHeight: '260px' }}>
            {filtered.length === 0 && (
              <CommandEmpty>No available products found.</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((opt) => {
                const isSelected = value === opt.value
                return (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onValueChange(opt.value, opt.label)
                      setOpen(false)
                      setSearch('')
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{opt.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {opt.availableCtn} CTN · {opt.availablePcs.toLocaleString('en-IN')} PCS
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewSellBillPage() {
  const router = useRouter()
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [billDate, setBillDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [extraCharges, setExtraCharges] = useState(0)
  const [extraChargesNote, setExtraChargesNote] = useState('')
  const [discount, setDiscount] = useState(0)
  const [discountNote, setDiscountNote] = useState('')
  const [lines, setLines] = useState<LineRow[]>([
    { id: '1', productSource: 'china', productId: '', productName: '', availableCtn: 0, ctnSold: 0, qtyPerCtn: 0, pcsSold: 0, ratePerPcs: 0, lineTotal: 0 },
  ])
  const [saving, setSaving] = useState(false)
  const [addCompanyName, setAddCompanyName] = useState<string | null>(null)

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: CompanyOption[] }>('/api/companies?limit=200')
    if (res.success) setCompanyOptions(res.data.companies)
  }, [])

  const fetchProducts = useCallback(async () => {
    const [chinaRes, indiaRes] = await Promise.all([
      apiGet<{ products: { _id: string; productName: string; availableCtn: number; qtyPerCtn?: number }[] }>('/api/products?limit=200'),
      apiGet<{ products: { _id: string; productName: string; availableCtn: number; qty?: number }[] }>('/api/india-products?limit=200'),
    ])
    const options: ProductOption[] = []

    if (chinaRes.success) {
      // Only show products with available CTN > 0
      const available = chinaRes.data.products.filter((p) => (p.availableCtn ?? 0) > 0)
      for (const p of available) {
        // Fetch qty per ctn to compute available PCS
        const qtyRes = await apiGet<{ qtyPerCtn: number }>(`/api/products/${p._id}/qty-per-ctn`).catch(() => ({ success: false as const, data: { qtyPerCtn: 0 } }))
        const qtyPerCtn = qtyRes.success ? (qtyRes.data.qtyPerCtn ?? 0) : 0
        options.push({
          value: `china:${p._id}`,
          label: `${p.productName} 🇨🇳 China`,
          availableCtn: p.availableCtn,
          availablePcs: Math.round(p.availableCtn * qtyPerCtn),
          qtyPerCtn,
        })
      }
    }

    if (indiaRes.success && (indiaRes.data as { products?: unknown[] }).products) {
      const indiaProds = (indiaRes.data as { products: { _id: string; productName: string; availableCtn: number; qty?: number }[] }).products
      const availableIndia = indiaProds.filter((p) => (p.availableCtn ?? 0) > 0)
      for (const p of availableIndia) {
        const qtyRes = await apiGet<{ qtyPerCtn: number }>(`/api/india-products/${p._id}/qty-per-ctn`).catch(() => ({ success: false as const, data: { qtyPerCtn: 0 } }))
        const qtyPerCtn = qtyRes.success ? (qtyRes.data.qtyPerCtn ?? 0) : 0
        options.push({
          value: `india:${p._id}`,
          label: `${p.productName} 🇮🇳 India`,
          availableCtn: p.availableCtn,
          availablePcs: Math.round(p.availableCtn * qtyPerCtn),
          qtyPerCtn,
        })
      }
    }

    setProductOptions(options)
  }, [])

  useEffect(() => {
    fetchCompanies()
    fetchProducts()
  }, [fetchCompanies, fetchProducts])

  function setLineProduct(id: string, compositeValue: string, productName: string) {
    const isIndia = compositeValue.startsWith('india:')
    const source: 'china' | 'india' = isIndia ? 'india' : 'china'
    const productId = compositeValue.includes(':') ? compositeValue.slice(compositeValue.indexOf(':') + 1) : compositeValue

    // Get cached stock info from productOptions
    const opt = productOptions.find((o) => o.value === compositeValue)

    setLines((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              productSource: source,
              productId,
              productName,
              availableCtn: opt?.availableCtn ?? 0,
              qtyPerCtn: opt?.qtyPerCtn ?? 0,
              ctnSold: 0,
              pcsSold: 0,
              lineTotal: 0,
            }
          : r
      )
    )
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { id: String(Date.now()), productSource: 'china', productId: '', productName: '', availableCtn: 0, ctnSold: 0, qtyPerCtn: 0, pcsSold: 0, ratePerPcs: 0, lineTotal: 0 },
    ])
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)))
  }

  function setLineCtn(id: string, ctn: number) {
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const pcs = r.qtyPerCtn ? Math.round(ctn * r.qtyPerCtn) : 0
        return { ...r, ctnSold: ctn, pcsSold: pcs, lineTotal: pcs * r.ratePerPcs }
      })
    )
  }

  function setLinePcs(id: string, pcs: number) {
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const ctn = r.qtyPerCtn > 0 ? parseFloat((pcs / r.qtyPerCtn).toFixed(4)) : 0
        return { ...r, ctnSold: ctn, pcsSold: pcs, lineTotal: pcs * r.ratePerPcs }
      })
    )
  }

  function setLineRate(id: string, rate: number) {
    setLines((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ratePerPcs: rate, lineTotal: r.pcsSold * rate } : r))
    )
  }

  const subtotal = lines.reduce((s, r) => s + r.lineTotal, 0)
  const grandTotal = calcGrandTotal(subtotal, extraCharges, discount)
  const canSave = companyId && lines.some((r) => r.productId && r.pcsSold > 0 && r.ratePerPcs >= 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const availablePcsByLine = lines.filter((r) => r.productId && r.pcsSold > 0).map((r) => ({
      id: r.id,
      availablePcs: r.availableCtn * r.qtyPerCtn,
      pcs: r.pcsSold,
      productName: r.productName,
    }))
    const over = availablePcsByLine.find((x) => x.pcs > x.availablePcs)
    if (over) {
      toast.error(`Only ${over.availablePcs} pcs available for ${over.productName || 'selected item'}.`)
      return
    }
    setSaving(true)
    const payload = {
      companyId,
      billDate: format(billDate, 'yyyy-MM-dd'),
      notes: notes.trim() || undefined,
      extraCharges,
      extraChargesNote: extraChargesNote.trim() || undefined,
      discount,
      discountNote: discountNote.trim() || undefined,
      items: lines
        .filter((r) => r.productId && r.pcsSold > 0)
        .map((r) => ({ productSource: r.productSource, productId: r.productId, pcs: r.pcsSold, ratePerPcs: r.ratePerPcs })),
    }
    const result = await apiPost<{ _id: string }>('/api/sell-bills', payload)
    setSaving(false)
    if (!result.success) {
      toast.error(result.message)
      return
    }
    toast.success('Bill created')
    router.push(`/sale-bills/${result.data._id}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Sale Bill"
        breadcrumb={
          <>
            <Link href="/sale-bills" className="text-muted-foreground hover:text-foreground">
              Sale Bills
            </Link>
            <span className="text-muted-foreground"> / New</span>
          </>
        }
      />

      {/* Quick Add Company Dialog */}
      {addCompanyName !== null && (
        <QuickAddCompanyDialog
          initialName={addCompanyName}
          onCreated={(company) => {
            setCompanyOptions((prev) => [...prev, company])
            setCompanyId(company._id)
            setAddCompanyName(null)
          }}
          onClose={() => setAddCompanyName(null)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Company *</Label>
              <CompanySelect
                options={companyOptions}
                value={companyId}
                onValueChange={setCompanyId}
                onRequestAdd={(name) => setAddCompanyName(name)}
              />
              {companyId === 'cashbook' && (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-2 text-xs text-green-700 dark:text-green-400 flex items-center gap-1 mt-1">
                  💵 Bill amount will be added directly to Cash balance
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Bill Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full justify-start text-left font-normal')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(billDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={billDate} onSelect={(d) => d && setBillDate(d)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Optional notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>₹{(Math.round(subtotal * 100) / 100).toLocaleString('en-IN')}</span>
            </div>
            {extraCharges > 0 && (
              <div className="flex justify-between text-sm text-orange-600 dark:text-orange-400">
                <span>+ Extra Charges {extraChargesNote && `(${extraChargesNote})`}</span>
                <span>+₹{extraCharges.toLocaleString('en-IN')}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>- Discount {discountNote && `(${discountNote})`}</span>
                <span>-₹{discount.toLocaleString('en-IN')}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>Grand Total</span>
              <AmountDisplay amount={Math.round(grandTotal * 100) / 100} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Line Items</Label>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="mr-2 h-4 w-4" />
              Add Another Product
            </Button>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="h-10 px-4 text-left font-medium">Product</th>
                  <th className="h-10 px-4 text-right font-medium w-24">CTN</th>
                  <th className="h-10 px-4 text-right font-medium w-24">PCS</th>
                  <th className="h-10 px-4 text-right font-medium w-28">Rate/PCS (₹)</th>
                  <th className="h-10 px-4 text-right font-medium w-28">Line Total</th>
                  <th className="h-10 w-12 px-4" />
                </tr>
              </thead>
              <tbody>
                {lines.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="p-2">
                      {/* Fixed height container prevents row from jumping */}
                      <div className="min-h-[56px]">
                        <ProductSelect
                          options={productOptions}
                          value={row.productId ? `${row.productSource}:${row.productId}` : ''}
                          onValueChange={(v, label) => setLineProduct(row.id, v, label)}
                        />
                        {row.productId && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Available: {row.availableCtn} CTN ({Math.round(row.availableCtn * row.qtyPerCtn).toLocaleString('en-IN')} pcs)
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-2 align-top pt-3">
                      <NumberInput
                        placeholder="0"
                        value={row.ctnSold === 0 ? undefined : row.ctnSold}
                        onChange={(v) => setLineCtn(row.id, v ?? 0)}
                        decimal={true}
                        min={0}
                        step={0.01}
                        className="w-24 text-right"
                      />
                    </td>
                    <td className="p-2 align-top pt-3">
                      <div>
                        <NumberInput
                          placeholder="0"
                          value={row.pcsSold === 0 ? undefined : row.pcsSold}
                          onChange={(v) => setLinePcs(row.id, v ?? 0)}
                          decimal={false}
                          min={0}
                          className="w-24 text-right"
                        />
                        {row.productId && row.qtyPerCtn > 0 && (
                          <p className="text-xs text-muted-foreground text-center mt-0.5">
                            {row.qtyPerCtn} pcs/ctn
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-2 align-top pt-3">
                      <NumberInput
                        placeholder="Rate"
                        prefix="₹"
                        value={row.ratePerPcs === 0 ? undefined : row.ratePerPcs}
                        onChange={(v) => setLineRate(row.id, v ?? 0)}
                        min={0}
                        className="text-right"
                      />
                    </td>
                    <td className="p-2 text-right font-medium align-top pt-3">
                      ₹{(row.pcsSold * row.ratePerPcs).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 align-top pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(row.id)}
                        disabled={lines.length <= 1}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <h4 className="text-sm font-medium">Adjustments</h4>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-3">
            <div className="flex-1 space-y-2">
              <Label className="text-xs text-muted-foreground">Extra Charges (₹)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={extraCharges === 0 ? '' : extraCharges}
                onChange={(e) => setExtraCharges(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label className="text-xs text-muted-foreground">Note (optional)</Label>
              <Input
                value={extraChargesNote}
                onChange={(e) => setExtraChargesNote(e.target.value)}
                placeholder="e.g. Freight, Packaging..."
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-3">
            <div className="flex-1 space-y-2">
              <Label className="text-xs text-muted-foreground">Discount (₹)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={discount === 0 ? '' : discount}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label className="text-xs text-muted-foreground">Note (optional)</Label>
              <Input
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                placeholder="e.g. Loyalty discount..."
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={!canSave || saving}>
            {saving ? 'Saving...' : 'Save Bill'}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/sale-bills">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
