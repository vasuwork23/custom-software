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
import { cn } from '@/lib/utils'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'

const amountSchema = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number({ required_error: 'Amount required' }).min(0.01, 'Amount must be greater than 0')
)
const schema = z.object({
  buyingEntryId: z.string().min(1, 'Select an entry'),
  bankAccountId: z.string().min(1, 'Select bank account'),
  amount: amountSchema,
  paymentDate: z.date(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface MakeIndiaPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productName: string
  onSuccess: () => void
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
      buyingEntryId: '',
      bankAccountId: '',
      amount: undefined,
      paymentDate: new Date(),
      notes: '',
    },
  })

  const watched = watch()

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
      reset({
        buyingEntryId: '',
        bankAccountId: '',
        amount: undefined,
        paymentDate: new Date(),
        notes: '',
      })
    }
  }, [open, productId, reset])

  async function onSubmit(values: FormValues) {
    const result = await apiPost('/api/india-buying-payments', {
      buyingEntryId: values.buyingEntryId,
      bankAccountId: values.bankAccountId,
      amount: values.amount ?? 0,
      paymentDate: values.paymentDate.toISOString(),
      notes: values.notes || undefined,
    })
    if (!result.success) {
      toast.error(result.message)
      return
    }
    toast.success('Payment recorded')
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make Payment — {productName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                    {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(e.remainingAmount ?? 0)} remaining
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.buyingEntryId && <p className="text-sm text-destructive">{errors.buyingEntryId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Bank Account</Label>
            <Select value={watched.bankAccountId} onValueChange={(v) => setValue('bankAccountId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select (Cash or Online)" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>
                    {a.accountName} — ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(a.currentBalance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.bankAccountId && <p className="text-sm text-destructive">{errors.bankAccountId.message}</p>}
          </div>
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
