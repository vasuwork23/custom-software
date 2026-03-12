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
  chinaPersonId: z.string().min(1, 'Select China Person'),
  amount: amountSchema,
  paymentDate: z.date(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface MakePaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productName: string
  onSuccess: () => void
}

export function MakePaymentDialog({
  open,
  onOpenChange,
  productId,
  productName,
  onSuccess,
}: MakePaymentDialogProps) {
  const [entries, setEntries] = useState<{ _id: string; entryDate: string; totalCtn: number; remainingAmount: number; currentStatus?: string }[]>([])
  const [chinaPersons, setChinaPersons] = useState<{ _id: string; name: string; currentBalance: number }[]>([])

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      buyingEntryId: '',
      chinaPersonId: '',
      amount: undefined,
      paymentDate: new Date(),
      notes: '',
    },
  })

  const watched = watch()
  const selectedEntry = entries.find((e) => e._id === watched.buyingEntryId)
  const remainingBalance = selectedEntry?.remainingAmount ?? 0

  useEffect(() => {
    if (open && productId) {
      apiGet<{ entries: { _id: string; entryDate: string; totalCtn: number; remainingAmount: number; currentStatus?: string }[] }>(
        `/api/buying-entries?productId=${productId}&limit=100`
      ).then((r) => {
        const list = r.success ? r.data.entries ?? [] : []
        setEntries(list.filter((e) => (e.currentStatus === 'unpaid' || e.currentStatus === 'partiallypaid') && (e.remainingAmount ?? 0) > 0))
      })
      apiGet<{ persons: { _id: string; name: string; currentBalance: number }[] }>('/api/sophia').then((r) => {
        if (r.success) setChinaPersons(r.data.persons)
        else setChinaPersons([])
      })
      reset({
        buyingEntryId: '',
        chinaPersonId: '',
        amount: undefined,
        paymentDate: new Date(),
        notes: '',
      })
    }
  }, [open, productId, reset])

  const amountValue = watched.amount ?? 0
  const exceedsRemaining =
    !!selectedEntry && Number.isFinite(amountValue) && amountValue > remainingBalance

  useEffect(() => {
    if (!selectedEntry || !amountValue) {
      clearErrors('amount')
      return
    }
    if (amountValue > remainingBalance) {
      clearErrors('amount')
      setError('amount', {
        type: 'manual',
        message: `Amount cannot exceed remaining balance of ¥${new Intl.NumberFormat('en-IN', {
          maximumFractionDigits: 0,
        }).format(remainingBalance)}`,
      })
    } else {
      clearErrors('amount')
    }
  }, [amountValue, remainingBalance, selectedEntry, clearErrors, setError])

  async function onSubmit(values: FormValues) {
    const result = await apiPost('/api/buying-payments', {
      buyingEntryId: values.buyingEntryId,
      productId,
      chinaPersonId: values.chinaPersonId,
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
                <SelectValue placeholder="Select entry (date + CTN + remaining ¥)" />
              </SelectTrigger>
              <SelectContent>
                {entries.map((e) => (
                  <SelectItem key={e._id} value={e._id}>
                    {format(new Date(e.entryDate), 'dd MMM yyyy')} — {e.totalCtn} CTN — ¥{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(e.remainingAmount ?? 0)} remaining
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.buyingEntryId && <p className="text-sm text-destructive">{errors.buyingEntryId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>China Person</Label>
            <Select value={watched.chinaPersonId} onValueChange={(v) => setValue('chinaPersonId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select (e.g. Sophia)" />
              </SelectTrigger>
              <SelectContent>
                {chinaPersons.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name} — ¥{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(p.currentBalance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.chinaPersonId && <p className="text-sm text-destructive">{errors.chinaPersonId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (¥ RMB)</Label>
            <Controller
              name="amount"
              control={control}
              render={({ field }) => (
                <NumberInput
                  id="amount"
                  placeholder="Enter amount"
                  prefix="¥"
                  value={field.value}
                  onChange={field.onChange}
                  min={0.01}
                  className={errors.amount ? 'border-destructive' : ''}
                />
              )}
            />
            {selectedEntry && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Remaining Balance:{' '}
                  {`¥${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
                    remainingBalance
                  )}`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setValue('amount', remainingBalance, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                >
                  Pay Full (
                  {`¥${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
                    remainingBalance
                  )}`}
                  )
                </Button>
              </div>
            )}
            {selectedEntry && (
              <p
                className={cn(
                  'text-xs',
                  exceedsRemaining
                    ? 'text-destructive'
                    : amountValue > 0 && remainingBalance - amountValue === 0
                    ? 'text-green-600'
                    : 'text-amber-600'
                )}
              >
                Balance after payment:{' '}
                {`¥${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
                  Math.max(remainingBalance - amountValue, 0)
                )}`}
              </p>
            )}
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
                <Calendar
                  mode="single"
                  selected={watched.paymentDate}
                  onSelect={(d) => d && setValue('paymentDate', d)}
                />
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
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !watched.buyingEntryId ||
                !watched.chinaPersonId ||
                !watched.amount ||
                exceedsRemaining
              }
            >
              {isSubmitting ? 'Saving…' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
