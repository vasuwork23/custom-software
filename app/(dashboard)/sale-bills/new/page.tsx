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
  QuickAddCompanyDialog,
  CompanySelect,
  ProductSelect,
  type CompanyOption,
} from '@/components/sale-bills/selects'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Bank Account Select ──────────────────────────────────────────────────────

function BankAccountSelect({
  options,
  value,
  onValueChange,
}: {
  options: { _id: string; accountName: string; currentBalance: number }[]
  value: string
  onValueChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((b) => b._id === value)

  return (
    <div className="space-y-1.5 mt-2">
      <div className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1">
        🏦 Bill amount will be added directly to the selected bank account
      </div>
      <Label className="text-xs">Select Bank Account *</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!selected && 'text-muted-foreground')}>
              {selected ? `${selected.accountName} — ₹${selected.currentBalance.toLocaleString('en-IN')}` : 'Select bank account'}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search bank accounts..." />
            <CommandList>
              {options.length === 0 && (
                <CommandEmpty>No bank accounts found. Add one in the Banks section.</CommandEmpty>
              )}
              <CommandGroup>
                {options.map((b) => (
                  <CommandItem
                    key={b._id}
                    value={b.accountName}
                    onSelect={() => { onValueChange(b._id); setOpen(false) }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === b._id ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex-1">{b.accountName}</span>
                    <span className="text-xs text-muted-foreground ml-2">₹{b.currentBalance.toLocaleString('en-IN')}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface BankAccountOption {
  _id: string
  accountName: string
  currentBalance: number
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewSellBillPage() {
  const router = useRouter()
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [bankAccountId, setBankAccountId] = useState<string>('')
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([])
  const [billDate, setBillDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [extraChargesStr, setExtraChargesStr] = useState('')
  const [extraChargesNote, setExtraChargesNote] = useState('')
  const [discountStr, setDiscountStr] = useState('')
  const [discountNote, setDiscountNote] = useState('')
  const extraCharges = parseFloat(extraChargesStr) || 0
  const discount = parseFloat(discountStr) || 0
  const [lines, setLines] = useState<LineRow[]>([
    { id: '1', productSource: 'china', productId: '', productName: '', availableCtn: 0, ctnSold: 0, qtyPerCtn: 0, pcsSold: 0, ratePerPcs: 0, lineTotal: 0 },
  ])
  const [saving, setSaving] = useState(false)
  const [addCompanyName, setAddCompanyName] = useState<string | null>(null)

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: CompanyOption[] }>('/api/companies?limit=200')
    if (res.success) setCompanyOptions(res.data.companies)
  }, [])

  const fetchBankAccounts = useCallback(async () => {
    const res = await apiGet<{ accounts: BankAccountOption[] }>('/api/banks')
    if (res.success) {
      setBankAccounts(res.data.accounts.filter((a: BankAccountOption & { type?: string }) => (a as { type?: string }).type === 'online'))
    }
  }, [])

  useEffect(() => {
    fetchCompanies()
    fetchBankAccounts()
  }, [fetchCompanies, fetchBankAccounts])

  function setLineProduct(id: string, compositeValue: string, productName: string, qtyPerCtn: number, availableCtn: number) {
    const isIndia = compositeValue.startsWith('india:')
    const source: 'china' | 'india' = isIndia ? 'india' : 'china'
    const productId = compositeValue.includes(':') ? compositeValue.slice(compositeValue.indexOf(':') + 1) : compositeValue

    setLines((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              productSource: source,
              productId,
              productName,
              availableCtn,
              qtyPerCtn,
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
  const isBankSale = companyId === 'bankaccount'
  const canSave = companyId && (!isBankSale || bankAccountId) && lines.some((r) => r.productId && r.pcsSold > 0 && r.ratePerPcs >= 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const availablePcsByLine = lines.filter((r) => r.productId && r.pcsSold > 0).map((r) => ({
      id: r.id,
      availablePcs: Math.round(r.availableCtn * r.qtyPerCtn),
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
      bankAccountId: isBankSale ? bankAccountId : undefined,
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
                onValueChange={(v) => { setCompanyId(v); if (v !== 'bankaccount') setBankAccountId('') }}
                onRequestAdd={(name) => setAddCompanyName(name)}
              />
              {companyId === 'cashbook' && (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-2 text-xs text-green-700 dark:text-green-400 flex items-center gap-1 mt-1">
                  💵 Bill amount will be added directly to Cash balance
                </div>
              )}
              {isBankSale && (
                <BankAccountSelect
                  options={bankAccounts}
                  value={bankAccountId}
                  onValueChange={setBankAccountId}
                />
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
                          value={row.productId ? `${row.productSource}:${row.productId}` : ''}
                          selectedLabel={row.productName}
                          onValueChange={(v, label, qtyPerCtn, availableCtn) => setLineProduct(row.id, v, label, qtyPerCtn, availableCtn)}
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
                value={extraChargesStr}
                onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setExtraChargesStr(e.target.value) }}
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
                value={discountStr}
                onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setDiscountStr(e.target.value) }}
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
