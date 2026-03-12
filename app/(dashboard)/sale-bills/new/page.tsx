'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn, calcGrandTotal } from '@/lib/utils'

interface CompanyOption {
  _id: string
  companyName: string
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

export default function NewSellBillPage() {
  const router = useRouter()
  const [companyOptions, setCompanyOptions] = useState<SearchableSelectOption<string>[]>([])
  const [productOptions, setProductOptions] = useState<SearchableSelectOption<string>[]>([])
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

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: CompanyOption[] }>('/api/companies?limit=200')
    if (res.success)
      setCompanyOptions(res.data.companies.map((c) => ({ value: c._id, label: c.companyName })))
  }, [])
  const fetchProducts = useCallback(async () => {
    const [chinaRes, indiaRes] = await Promise.all([
      apiGet<{ products: { _id: string; productName: string }[] }>('/api/products?limit=200'),
      apiGet<{ products: { _id: string; productName: string }[] }>('/api/india-products?limit=200'),
    ])
    const options: SearchableSelectOption<string>[] = []
    if (chinaRes.success)
      options.push(...chinaRes.data.products.map((p) => ({ value: `china:${p._id}`, label: `${p.productName} 🇨🇳 China` })))
    if (indiaRes.success && (indiaRes.data as { products?: { _id: string; productName: string }[] }).products)
      options.push(...(indiaRes.data as { products: { _id: string; productName: string }[] }).products.map((p) => ({ value: `india:${p._id}`, label: `${p.productName} 🇮🇳 India` })))
    setProductOptions(options)
  }, [])

  useEffect(() => {
    fetchCompanies()
    fetchProducts()
  }, [fetchCompanies, fetchProducts])

  async function fetchStockAndQty(source: 'china' | 'india', productId: string): Promise<{ availableCtn: number; qtyPerCtn: number }> {
    if (source === 'china') {
      const [detailRes, qtyRes] = await Promise.all([
        apiGet<{ availableCtn: number }>(`/api/products/${productId}`),
        apiGet<{ qtyPerCtn: number }>(`/api/products/${productId}/qty-per-ctn`),
      ])
      const data = detailRes.success ? detailRes.data : undefined
      const qtyData = qtyRes.success ? qtyRes.data : undefined
      return { availableCtn: data?.availableCtn ?? 0, qtyPerCtn: qtyData?.qtyPerCtn ?? 0 }
    }
    const [detailRes, qtyRes] = await Promise.all([
      apiGet<{ availableCtn: number }>(`/api/india-products/${productId}`),
      apiGet<{ qtyPerCtn: number }>(`/api/india-products/${productId}/qty-per-ctn`),
    ])
    const data = detailRes.success ? detailRes.data : undefined
    const qtyData = qtyRes.success ? qtyRes.data : undefined
    return { availableCtn: data?.availableCtn ?? 0, qtyPerCtn: qtyData?.qtyPerCtn ?? 0 }
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        productSource: 'china',
        productId: '',
        productName: '',
        availableCtn: 0,
        ctnSold: 0,
        qtyPerCtn: 0,
        pcsSold: 0,
        ratePerPcs: 0,
        lineTotal: 0,
      },
    ])
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)))
  }

  function setLineProduct(id: string, compositeValue: string, productName: string) {
    const isIndia = compositeValue.startsWith('india:')
    const source: 'china' | 'india' = isIndia ? 'india' : 'china'
    const productId = compositeValue.includes(':') ? compositeValue.slice(compositeValue.indexOf(':') + 1) : compositeValue
    setLines((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, productSource: source, productId, productName, availableCtn: 0, qtyPerCtn: 0, ctnSold: 0, pcsSold: 0, lineTotal: 0 }
          : r
      )
    )
    if (productId) {
      fetchStockAndQty(source, productId).then(({ availableCtn, qtyPerCtn }) => {
        setLines((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, availableCtn, qtyPerCtn }
              : r
          )
        )
      })
    }
  }

  function setLineCtn(id: string, ctn: number) {
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const pcs = r.qtyPerCtn ? Math.round(ctn * r.qtyPerCtn) : 0
        return {
          ...r,
          ctnSold: ctn,
          pcsSold: pcs,
          lineTotal: pcs * r.ratePerPcs,
        }
      })
    )
  }

  function setLinePcs(id: string, pcs: number) {
    setLines((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const ctn = r.qtyPerCtn > 0 ? parseFloat((pcs / r.qtyPerCtn).toFixed(4)) : 0
        return {
          ...r,
          ctnSold: ctn,
          pcsSold: pcs,
          lineTotal: pcs * r.ratePerPcs,
        }
      })
    )
  }

  function setLineRate(id: string, rate: number) {
    setLines((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, ratePerPcs: rate, lineTotal: r.pcsSold * rate } : r
      )
    )
  }

  const subtotal = lines.reduce((s, r) => s + r.lineTotal, 0)
  const grandTotal = calcGrandTotal(subtotal, extraCharges, discount)
  const canSave =
    companyId &&
    lines.some((r) => r.productId && r.pcsSold > 0 && r.ratePerPcs >= 0)

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
      toast.error(`Only ${over.availablePcs} pcs available for this product (${over.productName || 'selected item'}).`)
      return
    }
    setSaving(true)
    const payload = {
      companyId,
      billDate: billDate.toISOString().slice(0, 10),
      notes: notes.trim() || undefined,
      extraCharges,
      extraChargesNote: extraChargesNote.trim() || undefined,
      discount,
      discountNote: discountNote.trim() || undefined,
      items: lines
        .filter((r) => r.productId && r.pcsSold > 0)
        .map((r) => ({
          productSource: r.productSource,
          productId: r.productId,
          pcs: r.pcsSold,
          ratePerPcs: r.ratePerPcs,
        })),
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

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Company *</Label>
              <SearchableSelect
                options={[
                  { value: 'cashbook', label: '💵 Cashbook — Local buyer, direct cash payment' },
                  ...companyOptions,
                ]}
                value={companyId}
                onValueChange={setCompanyId}
                placeholder="Select company or Cashbook"
                searchPlaceholder="Search companies..."
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
                  <tr key={row.id} className="border-b">
                    <td className="p-2">
                      <div className="space-y-1">
                        <SearchableSelect
                          options={productOptions}
                          value={row.productId ? `${row.productSource}:${row.productId}` : ''}
                          onValueChange={(v) => {
                            const opt = productOptions.find((o) => o.value === v)
                            setLineProduct(row.id, v, opt?.label ?? '')
                          }}
                          placeholder="Select product"
                          searchPlaceholder="Search..."
                          className="min-w-[180px]"
                        />
                        {row.productId ? (
                          <p className="text-xs text-muted-foreground">
                            Available: {row.availableCtn} CTN ({row.availableCtn * row.qtyPerCtn} pcs)
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-2">
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
                    <td className="p-2">
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
                    <td className="p-2">
                      <NumberInput
                        placeholder="Rate"
                        prefix="₹"
                        value={row.ratePerPcs === 0 ? undefined : row.ratePerPcs}
                        onChange={(v) => setLineRate(row.id, v ?? 0)}
                        min={0}
                        className="text-right"
                      />
                    </td>
                    <td className="p-2 text-right font-medium">
                      ₹{(row.pcsSold * row.ratePerPcs).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-2">
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
