'use client'

import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface PendingEntry {
  _id: string
  entryDate: string
  totalCtn: number
  totalAmount: number
  givenAmount: number
  remainingAmount: number
  currentStatus: string
}

interface ChinaProductWithPending {
  _id: string
  productName: string
  pendingEntries: PendingEntry[]
}

interface SophiaPayOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  personId: string
  personName: string
}

const rmbFmt = (n: number) =>
  `¥${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`
const entryDateFmt = (d: string) => format(new Date(d), 'dd/MM/yyyy')

export function SophiaPayOutDialog({
  open,
  onOpenChange,
  onSuccess,
  personId,
  personName,
}: SophiaPayOutDialogProps) {
  const [products, setProducts] = useState<ChinaProductWithPending[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productId, setProductId] = useState<string>('')
  const [entryId, setEntryId] = useState<string>('')
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [paymentDate, setPaymentDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedProduct = useMemo(
    () => products.find((p) => String(p._id) === productId),
    [products, productId]
  )
  const pendingEntries = useMemo(
    () => selectedProduct?.pendingEntries ?? [],
    [selectedProduct]
  )
  const selectedEntry = useMemo(
    () => pendingEntries.find((e) => String(e._id) === entryId),
    [pendingEntries, entryId]
  )

  useEffect(() => {
    if (open) {
      setProductId('')
      setEntryId('')
      setAmount(undefined)
      setPaymentDate(new Date())
      setNotes('')
      setProductsLoading(true)
      apiGet<{ products: ChinaProductWithPending[] }>(
        '/api/products/china-with-pending-entries'
      ).then((r) => {
        setProductsLoading(false)
        if (r.success && r.data.products) setProducts(r.data.products)
        else setProducts([])
      })
    }
  }, [open])

  useEffect(() => {
    if (selectedEntry) {
      setAmount(selectedEntry.remainingAmount ?? 0)
    } else {
      setAmount(undefined)
    }
  }, [selectedEntry])

  useEffect(() => {
    if (!productId) setEntryId('')
  }, [productId])

  const amountNum = amount ?? 0
  const isValidAmount = Number.isFinite(amountNum) && amountNum > 0
  const remainingBefore = selectedEntry?.remainingAmount ?? 0
  const remainingAfter =
    selectedEntry && isValidAmount
      ? Math.max(0, remainingBefore - amountNum)
      : null
  const exceedsRemaining =
    !!selectedEntry && isValidAmount && amountNum > remainingBefore

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p._id),
        label: `${p.productName} (${p.pendingEntries.length} pending)`,
      })),
    [products]
  )

  const entryOptions = useMemo(
    () =>
      pendingEntries.map((e) => ({
        value: String(e._id),
        label: `${entryDateFmt(e.entryDate)} — CTN: ${e.totalCtn} — Total: ${rmbFmt(e.totalAmount)} — Remaining: ${rmbFmt(e.remainingAmount ?? 0)}`,
      })),
    [pendingEntries]
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!entryId || !productId) {
      toast.error('Select product and buying entry')
      return
    }
    if (!isValidAmount) {
      toast.error('Enter a valid amount (¥ RMB)')
      return
    }
    setSubmitting(true)
    const result = await apiPost<{ productName?: string }>(
      '/api/buying-payments',
      {
        buyingEntryId: entryId,
        productId,
        chinaPersonId: personId,
        amount: amountNum,
        paymentDate: format(paymentDate, 'yyyy-MM-dd'),
        notes: notes.trim() || undefined,
      }
    )
    setSubmitting(false)
    if (result.success) {
      const name = result.data?.productName ?? selectedProduct?.productName ?? 'Product'
      toast.success(`Payment of ${rmbFmt(amountNum)} recorded for ${name}`)
      onOpenChange(false)
      onSuccess()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Out — {personName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Select Product</Label>
            <SearchableSelect
              options={productOptions}
              value={productId || undefined}
              onValueChange={setProductId}
              placeholder={
                productsLoading ? 'Loading…' : 'Select product (China, with pending entries)'
              }
              emptyText="No products with unpaid/partially paid entries."
              disabled={productsLoading}
            />
          </div>

          {productId && (
            <div className="space-y-2">
              <Label>Select Buying Entry</Label>
              <SearchableSelect
                options={entryOptions}
                value={entryId || undefined}
                onValueChange={setEntryId}
                placeholder="Select entry (date, CTN, total, remaining)"
                emptyText="No pending entries."
              />
            </div>
          )}

          {selectedEntry && (
            <>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (¥ RMB)</Label>
                <div className="flex items-center gap-2">
                  <NumberInput
                    id="amount"
                    placeholder="Enter amount"
                    prefix="¥"
                    value={amount}
                    onChange={setAmount}
                    min={0.01}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(remainingBefore)}
                  >
                    Pay Full ({rmbFmt(remainingBefore)})
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Remaining Balance: {rmbFmt(remainingBefore)}
                </p>
                {remainingAfter !== null && (
                  <p
                    className={cn(
                      'text-xs',
                      exceedsRemaining
                        ? 'text-destructive'
                        : remainingAfter === 0
                        ? 'text-green-600'
                        : 'text-amber-600'
                    )}
                  >
                    Balance after payment: {rmbFmt(remainingAfter)}
                  </p>
                )}
                {exceedsRemaining && (
                  <p className="text-xs text-destructive">
                    Amount exceeds remaining balance of {rmbFmt(remainingBefore)}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn('w-full justify-start text-left font-normal')}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(paymentDate, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={paymentDate}
                      onSelect={(d) => d && setPaymentDate(d)}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                submitting || !entryId || !productId || !isValidAmount || exceedsRemaining
              }
            >
              {submitting ? 'Saving…' : 'Record Pay Out'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
