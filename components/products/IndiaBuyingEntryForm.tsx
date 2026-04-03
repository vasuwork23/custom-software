'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, AlertTriangle } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { apiGet, apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'

const numRequired = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number({ required_error: 'Required' }).min(0.01, 'Must be greater than 0')
)
const numOptional = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number().min(0).optional()
)
const schema = z.object({
  entryDate: z.date(),
  totalCtn: numRequired,
  qty: numRequired,
  rate: numRequired,
  hasAdvancePayment: z.boolean(),
  advanceBankAccount: z.string().optional(),
  advanceAmount: numOptional,
  advanceDate: z.date().optional(),
  advanceNote: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface IndiaBuyingEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productName: string
  onSuccess: () => void
  editEntry?: {
    _id: string
    entryDate: string
    totalCtn: number
    availableCtn?: number
    qty: number
    rate: number
    givenAmount: number
    hasAdvancePayment?: boolean
    advanceAmount?: number
    advanceBankAccount?: string
    advanceDate?: string
    advanceNote?: string
  } | null
}

export function IndiaBuyingEntryForm({
  open,
  onOpenChange,
  productId,
  productName,
  onSuccess,
  editEntry,
}: IndiaBuyingEntryFormProps) {
  const isEdit = !!editEntry
  const soldCtn = useMemo(() => {
    if (!editEntry) return 0
    const total = editEntry.totalCtn ?? 0
    const available = editEntry.availableCtn ?? total
    return Math.max(0, total - available)
  }, [editEntry])
  const costingLocked = isEdit && soldCtn > 0
  const lockedTooltip = soldCtn > 0 ? `Locked — ${soldCtn} CTN already sold. Revert sale bills to edit.` : undefined

  const [bankAccounts, setBankAccounts] = useState<{ _id: string; accountName: string; currentBalance: number }[]>([])

  useEffect(() => {
    if (open) {
      apiGet<{ accounts: { _id: string; accountName: string; currentBalance: number }[] }>('/api/banks').then((r) => {
        if (r.success) setBankAccounts(r.data.accounts ?? [])
      })
    }
  }, [open])

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entryDate: new Date(),
      totalCtn: undefined,
      qty: undefined,
      rate: undefined,
      hasAdvancePayment: false,
      advanceBankAccount: '',
      advanceAmount: undefined,
      advanceDate: undefined,
      advanceNote: '',
    },
  })

  const watched = watch()
  const totalQty = (watched.totalCtn ?? 0) * (watched.qty ?? 0)
  const totalAmount = totalQty * (watched.rate ?? 0)
  const givenDisplay = isEdit ? (editEntry?.givenAmount ?? 0) : (watched.hasAdvancePayment ? (watched.advanceAmount ?? 0) : 0)
  const remainingAmount = totalAmount - givenDisplay

  useEffect(() => {
    if (open && editEntry) {
      reset({
        entryDate: new Date(editEntry.entryDate),
        totalCtn: editEntry.totalCtn,
        qty: editEntry.qty,
        rate: editEntry.rate,
        hasAdvancePayment: editEntry.hasAdvancePayment ?? false,
        advanceBankAccount: editEntry.advanceBankAccount ?? '',
        advanceAmount: editEntry.advanceAmount,
        advanceDate: editEntry.advanceDate ? new Date(editEntry.advanceDate) : undefined,
        advanceNote: editEntry.advanceNote ?? '',
      })
    } else if (open && !editEntry) {
      reset({
        entryDate: new Date(),
        totalCtn: undefined,
        qty: undefined,
        rate: undefined,
        hasAdvancePayment: false,
        advanceBankAccount: '',
        advanceAmount: undefined,
        advanceDate: undefined,
        advanceNote: '',
      })
    }
  }, [open, editEntry, reset])

  async function onSubmit(values: FormValues) {
    if (values.hasAdvancePayment) {
      if (!values.advanceBankAccount) {
        toast.error('Please select a bank account for the advance payment')
        return
      }
      if (!values.advanceAmount || values.advanceAmount <= 0) {
        toast.error('Please enter a positive advance amount')
        return
      }
    }

    const payload = {
      product: productId,
      entryDate: format(values.entryDate, 'yyyy-MM-dd'),
      totalCtn: values.totalCtn ?? 0,
      qty: values.qty ?? 0,
      rate: values.rate ?? 0,
      hasAdvancePayment: values.hasAdvancePayment,
      advanceBankAccount: values.hasAdvancePayment && values.advanceBankAccount ? values.advanceBankAccount : null,
      advanceAmount: values.hasAdvancePayment ? (values.advanceAmount ?? null) : null,
      advanceDate: values.hasAdvancePayment && values.advanceDate ? format(values.advanceDate, 'yyyy-MM-dd') : null,
      advanceNote: values.hasAdvancePayment ? (values.advanceNote ?? null) : null,
    }
    if (isEdit) {
      const result = await apiPut(`/api/india-buying-entries/${editEntry._id}`, payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Entry updated')
    } else {
      const result = await apiPost('/api/india-buying-entries', payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Entry created')
    }
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto w-[75vw] max-w-[75vw] p-6">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Buying Entry' : 'Add Buying Entry'} — {productName}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()

              const activeEl = document.activeElement as HTMLElement | null
              if (!activeEl) return

              const isSubmitButton =
                activeEl.tagName === 'BUTTON' &&
                (activeEl.textContent?.includes('Update') ||
                  activeEl.textContent?.includes('Create') ||
                  activeEl.textContent?.includes('Save'))

              if (isSubmitButton) {
                activeEl.click()
              }
            }
          }}
          className="mt-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {costingLocked && (
              <div className="col-span-1 sm:col-span-2 lg:col-span-4">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <p>{soldCtn} CTN already sold from this entry. Costing fields are locked to protect profit calculations.</p>
                </div>
              </div>
            )}

            {/* Row 1: Entry Date | Total CTN | QTY per CTN | (spacer) */}
            <div className="space-y-2">
              <Label>Entry Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !watched.entryDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {watched.entryDate ? format(watched.entryDate, 'PPP') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={watched.entryDate} onSelect={(d) => d && setValue('entryDate', d)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalCtn">Total CTN *</Label>
              <Controller
                name="totalCtn"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="totalCtn"
                    placeholder="Enter CTN"
                    value={field.value}
                    onChange={field.onChange}
                    readOnly={costingLocked}
                    disabled={costingLocked}
                    title={lockedTooltip}
                    decimal={false}
                    className={cn(errors.totalCtn ? 'border-destructive' : '', costingLocked && 'bg-muted cursor-not-allowed')}
                  />
                )}
              />
              {errors.totalCtn && <p className="text-sm text-destructive">{errors.totalCtn.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty">QTY per CTN *</Label>
              <Controller
                name="qty"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="qty"
                    placeholder="Enter QTY"
                    value={field.value}
                    onChange={field.onChange}
                    readOnly={costingLocked}
                    disabled={costingLocked}
                    title={lockedTooltip}
                    decimal={false}
                    className={cn(errors.qty ? 'border-destructive' : '', costingLocked && 'bg-muted cursor-not-allowed')}
                  />
                )}
              />
              {errors.qty && <p className="text-sm text-destructive">{errors.qty.message}</p>}
            </div>

            <div />

            {/* Row 2: Rate + 3 empty columns (for future fields if needed) */}
            <div className="space-y-2">
              <Label htmlFor="rate">Rate per piece (₹) *</Label>
              <Controller
                name="rate"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="rate"
                    placeholder="Enter rate"
                    prefix="₹"
                    value={field.value}
                    onChange={field.onChange}
                    readOnly={costingLocked}
                    disabled={costingLocked}
                    title={lockedTooltip}
                    className={cn(errors.rate ? 'border-destructive' : '', costingLocked && 'bg-muted cursor-not-allowed')}
                  />
                )}
              />
              {errors.rate && <p className="text-sm text-destructive">{errors.rate.message}</p>}
            </div>
            <div />
            <div />
            <div />

            {/* Row 3: Auto-calculated panel full width */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="text-sm font-semibold text-muted-foreground mb-3">
                  Auto-calculated
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Total QTY</span>
                    <span className="font-semibold text-sm">{totalQty}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Total Amount</span>
                    <span className="font-semibold text-sm">
                      ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(totalAmount)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Final Cost per piece</span>
                    <span className="font-semibold text-sm">
                      ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(watched.rate ?? 0)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Given Amount</span>
                    <span className="font-semibold text-sm">
                      ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(givenDisplay)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Remaining Amount</span>
                    <span className="font-semibold text-sm">
                      ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(remainingAmount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 4: Advance Payment checkbox full width */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4">
              <div className="flex items-center gap-2">
                <Controller
                  name="hasAdvancePayment"
                  control={control}
                  render={({ field }) => (
                    <>
                      <input
                        type="checkbox"
                        id="hasAdvancePayment"
                        checked={!!field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            field.onChange(!field.value)
                          }
                        }}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className="h-4 w-4 rounded border-input"
                      />
                      <Label htmlFor="hasAdvancePayment" className="cursor-pointer font-normal">
                        Advance Payment
                      </Label>
                    </>
                  )}
                />
              </div>
            </div>

            {/* Rows 5-6: advance payment fields when checked */}
            {watched.hasAdvancePayment && (
              <>
                <div className="space-y-2">
                  <Label>Bank Account</Label>
                  <Controller
                    name="advanceBankAccount"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account (Cash or Online)" />
                        </SelectTrigger>
                        <SelectContent>
                          {bankAccounts.map((a) => (
                            <SelectItem key={a._id} value={a._id}>
                              {a.accountName} — ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(a.currentBalance)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="advanceAmount">Advance Amount (₹)</Label>
                  <Controller
                    name="advanceAmount"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="advanceAmount"
                        placeholder="Enter advance amount"
                        prefix="₹"
                        value={field.value}
                        onChange={field.onChange}
                        className={errors.advanceAmount ? 'border-destructive' : ''}
                      />
                    )}
                  />
                  {errors.advanceAmount && <p className="text-sm text-destructive">{errors.advanceAmount.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Advance Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn('w-full justify-start text-left font-normal', !watched.advanceDate && 'text-muted-foreground')}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {watched.advanceDate ? format(watched.advanceDate, 'PPP') : 'Pick date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={watched.advanceDate} onSelect={(d) => setValue('advanceDate', d)} />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-2">
                  <Label htmlFor="advanceNote">Advance Note (optional)</Label>
                  <Input id="advanceNote" {...register('advanceNote')} placeholder="Optional note" />
                </div>
              </>
            )}

            {/* Row 7: Buttons */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4 flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isEdit ? (isSubmitting ? 'Saving…' : 'Update') : isSubmitting ? 'Saving…' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
