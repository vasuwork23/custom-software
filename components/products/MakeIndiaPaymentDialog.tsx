'use client'

import React, { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { cn } from '@/lib/utils'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'

const amountSchema = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number({ required_error: 'Amount required' }).min(0.01, 'Amount must be greater than 0')
)

const schema = z.object({
  paymentSource: z.enum(['bank', 'company']),
  buyingEntryId: z.string().min(1, 'Select an entry'),
  bankAccountId: z.string().optional(),
  companyId: z.string().optional(),
  amount: amountSchema,
  paymentDate: z.date(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.paymentSource === 'bank' && !data.bankAccountId) {
    ctx.addIssue({ code: 'custom', path: ['bankAccountId'], message: 'Select bank account' })
  }
  if (data.paymentSource === 'company' && !data.companyId) {
    ctx.addIssue({ code: 'custom', path: ['companyId'], message: 'Select company' })
  }
})

type FormValues = z.infer<typeof schema>

interface MakeIndiaPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productName: string
  onSuccess: () => void
}

interface CompanyOption {
  _id: string
  companyName: string
  outstandingBalance: number
}

export function MakeIndiaPaymentDialog({
  open,
  onOpenChange,
  productId,
  productName,
  onSuccess,
}: MakeIndiaPaymentDialogProps) {
  const [entries, setEntries] = useState<{ _id: string; entryDate: string; totalCtn: number; remainingAmount: number }[]>([])
  const [accounts, setAccounts] = useState<{ _id: string; accountName: string; currentBalance: number }[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [paymentSource, setPaymentSource] = useState<'bank' | 'company'>('bank')

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      paymentSource: 'bank',
      buyingEntryId: '',
      bankAccountId: '',
      companyId: '',
      amount: undefined as unknown as number,
      paymentDate: new Date(),
      notes: '',
    },
  })

  const watched = watch()

  const selectedCompanyOutstanding = companies.find((c) => c._id === watched.companyId)?.outstandingBalance ?? null

  useEffect(() => {
    if (open && productId) {
      apiGet<{ entries: { _id: string; entryDate: string; totalCtn: number; remainingAmount: number }[] }>(
        `/api/india-buying-entries?productId=${productId}&limit=100`
      ).then((r) => {
        if (r.success) setEntries(r.data.entries ?? [])
        else setEntries([])
      })
      apiGet<{ accounts: { _id: string; accountName: string; currentBalance: number }[] }>('/api/banks').then((r) => {
        if (r.success) setAccounts(r.data.accounts ?? [])
        else setAccounts([])
      })
      apiGet<{ companies: { _id: string; companyName: string; outstandingBalance: number }[] }>('/api/companies?limit=500').then((r) => {
        if (r.success) setCompanies(r.data.companies ?? [])
        else setCompanies([])
      })
      setPaymentSource('bank')
      reset({
        paymentSource: 'bank',
        buyingEntryId: '',
        bankAccountId: '',
        companyId: '',
        amount: undefined as unknown as number,
        paymentDate: new Date(),
        notes: '',
      })
    }
  }, [open, productId, reset])

  function handleSourceToggle(source: 'bank' | 'company') {
    setPaymentSource(source)
    setValue('paymentSource', source)
    setValue('bankAccountId', '')
    setValue('companyId', '')
  }

  async function onSubmit(values: FormValues) {
    const payload: Record<string, unknown> = {
      buyingEntryId: values.buyingEntryId,
      amount: values.amount ?? 0,
      paymentDate: format(values.paymentDate, 'yyyy-MM-dd'),
      notes: values.notes || undefined,
    }
    if (values.paymentSource === 'company') {
      payload.companyId = values.companyId
    } else {
      payload.bankAccountId = values.bankAccountId
    }

    const result = await apiPost('/api/india-buying-payments', payload)
    if (!result.success) {
      toast.error(result.message)
      return
    }
    toast.success('Payment recorded')
    onOpenChange(false)
    onSuccess()
  }

  const companyOptions: SearchableSelectOption<string>[] = companies.map((c) => ({
    value: c._id,
    label: c.companyName,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make Payment — {productName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Payment Source Toggle */}
          <div className="space-y-2">
            <Label>Payment Source</Label>
            <div className="flex rounded-md border overflow-hidden">
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 text-sm font-medium transition-colors',
                  paymentSource === 'bank'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => handleSourceToggle('bank')}
              >
                Bank / Cash
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 text-sm font-medium transition-colors border-l',
                  paymentSource === 'company'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => handleSourceToggle('company')}
              >
                Company Set-off
              </button>
            </div>
          </div>

          {/* Buying Entry */}
          <div className="space-y-2">
            <Label>Buying Entry</Label>
            <Select value={watched.buyingEntryId} onValueChange={(v) => setValue('buyingEntryId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select entry (date + CTN + remaining ₹)" />
              </SelectTrigger>
              <SelectContent>
                {entries.map((e) => (
                  <SelectItem key={e._id} value={e._id}>
                    {format(new Date(e.entryDate), 'dd MMM yyyy')} — {e.totalCtn} CTN — ₹
                    {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(e.remainingAmount ?? 0)} remaining
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.buyingEntryId && <p className="text-sm text-destructive">{errors.buyingEntryId.message}</p>}
          </div>

          {/* Bank Account (bank path) */}
          {paymentSource === 'bank' && (
            <div className="space-y-2">
              <Label>Bank Account</Label>
              <Select value={watched.bankAccountId ?? ''} onValueChange={(v) => setValue('bankAccountId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select (Cash or Online)" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.accountName} — ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(a.currentBalance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.bankAccountId && (
                <p className="text-sm text-destructive">{errors.bankAccountId.message}</p>
              )}
            </div>
          )}

          {/* Company (set-off path) */}
          {paymentSource === 'company' && (
            <div className="space-y-2">
              <Label>Company</Label>
              <SearchableSelect
                options={companyOptions}
                value={watched.companyId ?? ''}
                onValueChange={(v) => setValue('companyId', v)}
                placeholder="Search company…"
              />
              {selectedCompanyOutstanding !== null && (
                <p className={cn(
                  'text-xs font-medium',
                  selectedCompanyOutstanding > 0 ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'
                )}>
                  Outstanding: ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(selectedCompanyOutstanding))}
                  {selectedCompanyOutstanding <= 0 ? ' (advance/credit)' : ''}
                </p>
              )}
              {errors.companyId && (
                <p className="text-sm text-destructive">{errors.companyId.message}</p>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Controller
              name="amount"
              control={control}
              render={({ field }) => (
                <NumberInput
                  id="amount"
                  placeholder="Enter amount"
                  prefix="₹"
                  value={field.value}
                  onChange={field.onChange}
                  min={0.01}
                  className={errors.amount ? 'border-destructive' : ''}
                />
              )}
            />
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
          </div>

          {/* Payment Date */}
          <div className="space-y-2">
            <Label>Payment Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !watched.paymentDate && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {watched.paymentDate ? format(watched.paymentDate, 'PPP') : 'Pick date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={watched.paymentDate} onSelect={(d) => d && setValue('paymentDate', d)} />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" {...register('notes')} placeholder="Optional" />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
