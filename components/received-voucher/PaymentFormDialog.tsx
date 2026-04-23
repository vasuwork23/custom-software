'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { NumberInput } from '@/components/ui/NumberInput'
import { Label } from '@/components/ui/label'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiGet, apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface PaymentFormValues {
  _id: string
  companyId: string
  companyName: string
  amount: number
  paymentMode: 'cash' | 'online'
  bankAccountId?: string
  bankAccountName?: string
  paymentDate: string
  remark?: string
  companyNote?: string
}

interface PaymentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editPayment: PaymentFormValues | null
  preselectedCompanyId?: string
  preselectedCompanyName?: string
}

export function PaymentFormDialog({
  open,
  onOpenChange,
  onSuccess,
  editPayment,
  preselectedCompanyId,
  preselectedCompanyName,
}: PaymentFormDialogProps) {
  const [companyOptions, setCompanyOptions] = useState<SearchableSelectOption<string>[]>([])
  const [bankOptions, setBankOptions] = useState<SearchableSelectOption<string>[]>([])
  const [companyId, setCompanyId] = useState('')
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [paymentMode, setPaymentMode] = useState<'cash' | 'online'>('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentDate, setPaymentDate] = useState<Date>(new Date())
  const [remark, setRemark] = useState('')
  const [companyNote, setCompanyNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [outstanding, setOutstanding] = useState<number | null>(null)
  const [outstandingLoading, setOutstandingLoading] = useState(false)

  const formatInr = (n: number) =>
    new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: { _id: string; companyName: string }[] }>('/api/companies?limit=500')
    if (res.success) setCompanyOptions(res.data.companies.map((c) => ({ value: c._id, label: c.companyName })))
  }, [])
  const fetchBanks = useCallback(async () => {
    const res = await apiGet<{ accounts: { _id: string; accountName: string; type: string }[] }>('/api/banks')
    if (res.success) {
      const online = res.data.accounts.filter((a) => a.type === 'online')
      setBankOptions(online.map((a) => ({ value: a._id, label: a.accountName })))
    }
  }, [])

  const fetchOutstanding = useCallback(
    async (id: string) => {
      if (!id) {
        setOutstanding(null)
        return
      }
      setOutstanding(null)
      setOutstandingLoading(true)
      const res = await apiGet<{
        totalBilled: number
        totalReceived: number
        outstanding: number
      }>(`/api/companies/${id}/outstanding`)
      setOutstandingLoading(false)
      if (!res.success) {
        toast.error(res.message)
        setOutstanding(null)
        return
      }
      setOutstanding(res.data.outstanding ?? 0)
    },
    []
  )

  useEffect(() => {
    if (open) {
      fetchCompanies()
      fetchBanks()
    }
  }, [open, fetchCompanies, fetchBanks])

  useEffect(() => {
    if (!open) return
    if (editPayment) {
      setCompanyId(editPayment.companyId)
      setAmount(editPayment.amount)
      setPaymentMode(editPayment.paymentMode)
      setBankAccountId(editPayment.bankAccountId ?? '')
      setPaymentDate(editPayment.paymentDate ? new Date(editPayment.paymentDate) : new Date())
      setRemark(editPayment.remark ?? '')
      setCompanyNote(editPayment.companyNote ?? '')
    } else {
      setCompanyId(preselectedCompanyId ?? '')
      setAmount(undefined)
      setPaymentMode('cash')
      setBankAccountId('')
      setPaymentDate(new Date())
      setRemark('')
      setCompanyNote('')
    }
  }, [open, editPayment, preselectedCompanyId])

  useEffect(() => {
    if (!open) return
    if (companyId) {
      fetchOutstanding(companyId)
    } else {
      setOutstanding(null)
    }
  }, [companyId, open, fetchOutstanding])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const numAmount = amount ?? 0
    if (!companyId) {
      toast.error('Select a company')
      return
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (paymentMode === 'online' && !bankAccountId) {
      toast.error('Select a bank account for online payment')
      return
    }
    setSubmitting(true)
    const payload = {
      companyId,
      amount: numAmount,
      paymentMode,
      bankAccountId: paymentMode === 'online' ? bankAccountId : undefined,
      paymentDate: format(paymentDate, 'yyyy-MM-dd'),
      remark: remark.trim() || undefined,
      companyNote: companyNote.trim() || undefined,
    }
    if (editPayment) {
      const result = await apiPut(`/api/received-voucher/${editPayment._id}`, payload)
      setSubmitting(false)
      if (result.success) {
        toast.success('Voucher updated')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    } else {
      const result = await apiPost('/api/received-voucher', payload)
      setSubmitting(false)
      if (result.success) {
        toast.success('Voucher recorded')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    }
  }

  const numAmount = amount ?? 0
  const hasOutstanding = outstanding != null
  const isEditMode = !!editPayment
  const oldAmount = editPayment?.amount ?? 0
  const newAmount = numAmount
  const diff = newAmount - oldAmount

  const balanceAfter =
    hasOutstanding && Number.isFinite(newAmount) && newAmount > 0
      ? isEditMode
        ? outstanding! + oldAmount - newAmount
        : outstanding! - newAmount
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editPayment ? 'Edit Voucher' : 'Add Voucher'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Company</Label>
            <SearchableSelect
              options={companyOptions}
              value={companyId}
              onValueChange={setCompanyId}
              placeholder="Select company"
              disabled={!!preselectedCompanyId && !editPayment}
            />
          </div>
          {companyId && (
            <div className="text-sm">
              {outstandingLoading ? (
                <div className="rounded-md border border-muted bg-muted/40 p-2 text-xs text-muted-foreground">
                  Loading outstanding…
                </div>
              ) : hasOutstanding ? (
                outstanding! > 0 ? (
                  <div className="rounded-md bg-orange-50 border border-orange-200 p-2 text-sm">
                    <span className="text-orange-600 font-medium">
                      Outstanding: ₹{formatInr(outstanding!)}
                    </span>
                    <span className="text-orange-400 text-xs ml-2">
                      (amount pending from company)
                    </span>
                  </div>
                ) : outstanding === 0 ? (
                  <div className="rounded-md bg-green-50 border border-green-200 p-2 text-sm">
                    <span className="text-green-600 font-medium">
                      ✅ No outstanding — account is clear
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-2 text-sm">
                    <span className="text-blue-600 font-medium">
                      Credit Balance: ₹{formatInr(Math.abs(outstanding!))}
                    </span>
                    <span className="text-blue-400 text-xs ml-2">
                      (company has paid extra)
                    </span>
                  </div>
                )
              ) : null}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (₹)</Label>
            <NumberInput
              id="amount"
              placeholder="Enter amount"
              prefix="₹"
              value={amount}
              onChange={setAmount}
              min={0.01}
            />
            {hasOutstanding && balanceAfter !== null && !isEditMode && (
              <p
                className={cn(
                  'text-xs mt-1',
                  balanceAfter > 0
                    ? 'text-orange-600'
                    : balanceAfter === 0
                    ? 'text-green-600'
                    : 'text-blue-600'
                )}
              >
                {balanceAfter > 0 &&
                  `Remaining after payment: ₹${formatInr(balanceAfter)}`}
                {balanceAfter === 0 && '✅ Account will be fully cleared'}
                {balanceAfter < 0 &&
                  `₹${formatInr(Math.abs(balanceAfter))} will be credited (advance payment)`}
              </p>
            )}
            {hasOutstanding && balanceAfter !== null && isEditMode && (
              <div className="text-xs mt-1 space-y-1">
                <p
                  className={cn(
                    balanceAfter > 0
                      ? 'text-orange-600'
                      : balanceAfter === 0
                      ? 'text-green-600'
                      : 'text-blue-600'
                  )}
                >
                  {balanceAfter > 0 &&
                    `Remaining after edit: ₹${formatInr(balanceAfter)}`}
                  {balanceAfter === 0 && '✅ Account will be fully cleared after edit'}
                  {balanceAfter < 0 &&
                    `Credit balance after edit: ₹${formatInr(Math.abs(balanceAfter))}`}
                </p>
                {newAmount > 0 && (
                  <>
                    {diff === 0 && (
                      <p className="text-gray-500">
                        Amount unchanged — no balance adjustment
                      </p>
                    )}
                    {diff > 0 && (
                      <p className="text-green-600">
                        ₹{formatInr(diff)} additional amount will be received (
                        ₹{formatInr(oldAmount)} → ₹{formatInr(newAmount)})
                      </p>
                    )}
                    {diff < 0 && (
                      <p className="text-orange-600">
                        ₹{formatInr(Math.abs(diff))} will be reversed (
                        ₹{formatInr(oldAmount)} → ₹{formatInr(newAmount)})
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Payment Mode</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={paymentMode === 'cash'}
                  onChange={() => setPaymentMode('cash')}
                  className="rounded-full"
                />
                <span>Cash</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={paymentMode === 'online'}
                  onChange={() => setPaymentMode('online')}
                  className="rounded-full"
                />
                <span>Online</span>
              </label>
            </div>
          </div>
          {paymentMode === 'online' && (
            <div className="space-y-2">
              <Label>Bank Account</Label>
              <SearchableSelect
                options={bankOptions}
                value={bankAccountId}
                onValueChange={setBankAccountId}
                placeholder="Select bank account"
                emptyText="No online accounts. Add one in Our Banks."
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(paymentDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="remark">Remark (optional)</Label>
            <Input
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Cheque no, UTR, note..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyNote">Company Note (optional)</Label>
            <Input
              id="companyNote"
              value={companyNote}
              onChange={(e) => setCompanyNote(e.target.value)}
              placeholder="Note visible on company side and PDF..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : editPayment ? 'Update' : 'Add Voucher'}
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
