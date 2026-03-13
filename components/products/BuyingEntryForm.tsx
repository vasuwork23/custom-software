'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, Info, X } from 'lucide-react'
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
import { WarehouseStatusSelect, type WarehouseStatus } from '@/components/products/WarehouseStatusSelect'
import { AutoCalculatedFields } from '@/components/products/AutoCalculatedFields'
import { cn } from '@/lib/utils'
import { apiGet, apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const numRequired = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number({ required_error: 'Required' }).min(0.01, 'Must be greater than 0')
)
const numOptional = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number().min(0).optional()
)
const schema = z
  .object({
    mark: z
      .string()
      .trim()
      .min(1, 'Mark is required'),
    entryDate: z.date(),
    totalCtn: numRequired,
    qty: numRequired,
    rate: numRequired,
    cbm: numRequired,
    weight: numRequired,
    hasAdvancePayment: z.boolean(),
    advanceAmount: numOptional,
    advanceChinaPerson: z.string().optional(),
    advanceDate: z.date().optional(),
    advanceNote: z.string().optional(),
    carryingRate: numOptional,
    avgRmbRate: numOptional,
    chinaWarehouseReceived: z.enum(['yes', 'no']),
    chinaWarehouseCtn: numOptional,
    inTransitCtn: numOptional,
  })
  .superRefine((val, ctx) => {
    const totalQty = (val.totalCtn as number) * (val.qty as number)
    // Round to 2 decimals to avoid floating point issues
    const rawTotalAmount = totalQty * (val.rate as number)
    const totalAmount = Math.round(rawTotalAmount * 100) / 100

    if (val.hasAdvancePayment) {
      const advanceAmount = val.advanceAmount as number | undefined
      const advanceChinaPerson = (val.advanceChinaPerson as string | undefined) ?? ''

      if (!advanceChinaPerson.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['advanceChinaPerson'],
          message: 'Please select a China Person for advance payment',
        })
      }

      if (advanceAmount == null || advanceAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['advanceAmount'],
          message: 'Please enter advance amount',
        })
      }

      // Allow equal or very slightly higher values due to rounding differences
      if (advanceAmount != null && advanceAmount > totalAmount + 0.0001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['advanceAmount'],
          message: `Advance cannot exceed total amount of ¥${new Intl.NumberFormat('en-IN', {
            maximumFractionDigits: 0,
          }).format(totalAmount)}`,
        })
      }
    }

    if (val.chinaWarehouseReceived === 'yes') {
      const chinaCtn = (val.chinaWarehouseCtn as number | undefined) ?? 0
      const transitCtn = (val.inTransitCtn as number | undefined) ?? 0
      if (chinaCtn < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chinaWarehouseCtn'],
          message: 'China Warehouse CTN cannot be negative',
        })
      }
      if (transitCtn < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['inTransitCtn'],
          message: 'In Transit CTN cannot be negative',
        })
      }
      const totalCtn = val.totalCtn as number
      if (chinaCtn + transitCtn > totalCtn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chinaWarehouseCtn'],
          message: 'China + In Transit CTN cannot exceed Total CTN',
        })
      }
    }
  })

type FormValues = z.infer<typeof schema>

interface BuyingEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  onSuccess: () => void
  editEntry?: {
    _id: string
    mark: string
    entryDate: string
    totalCtn: number
    availableCtn?: number
    soldCtn?: number
    isLocked?: boolean
    qty: number
    rate: number
    cbm: number
    weight: number
    givenAmount: number
    hasAdvancePayment?: boolean
    advanceAmount?: number
    advanceChinaPerson?: string
    advanceDate?: string
    advanceNote?: string
    carryingRate?: number
    avgRmbRate?: number
    chinaWarehouseReceived: 'yes' | 'no'
    chinaWarehouseCtn?: number
    inTransitCtn?: number
  } | null
}

export function BuyingEntryForm({
  open,
  onOpenChange,
  productId,
  onSuccess,
  editEntry,
}: BuyingEntryFormProps) {
  const isEdit = !!editEntry
  const soldCtn = useMemo(() => {
    if (!editEntry) return 0
    return Math.max(0, editEntry.soldCtn ?? 0)
  }, [editEntry])

  const [chinaPersons, setChinaPersons] = useState<{ _id: string; name: string; currentBalance: number }[]>([])
  const [pendingLockAfterSave, setPendingLockAfterSave] = useState<{
    entryId: string
    chinaWarehouseCtn: number
    inTransitCtn: number
  } | null>(null)
  const [lockSubmitting, setLockSubmitting] = useState(false)
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      apiGet<{ persons: { _id: string; name: string; currentBalance: number }[] }>('/api/sophia').then((r) => {
        if (r.success) setChinaPersons(r.data.persons)
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
      mark: '',
      entryDate: new Date(),
      totalCtn: undefined,
      qty: undefined,
      rate: undefined,
      cbm: undefined,
      weight: undefined,
      hasAdvancePayment: false,
      advanceAmount: undefined,
      advanceChinaPerson: '',
      advanceDate: undefined,
      advanceNote: '',
      carryingRate: undefined,
      avgRmbRate: undefined,
      chinaWarehouseReceived: 'no',
      chinaWarehouseCtn: undefined,
      inTransitCtn: undefined,
    },
  })

  const watched = watch()
  const watchTotalCtn = watch('totalCtn')
  const watchChinaWarehouseCtn = watch('chinaWarehouseCtn')
  const watchInTransitCtn = watch('inTransitCtn')
  const [ctnWarning, setCtnWarning] = useState<string | null>(null)
  const [totalCtnError, setTotalCtnError] = useState<string | null>(null)
  useEffect(() => {
    if (open) setTotalCtnError(null)
    if (open && editEntry) {
      reset({
        mark: editEntry.mark,
        entryDate: new Date(editEntry.entryDate),
        totalCtn: editEntry.totalCtn,
        qty: editEntry.qty,
        rate: editEntry.rate,
        cbm: editEntry.cbm,
        weight: editEntry.weight,
        hasAdvancePayment: editEntry.hasAdvancePayment ?? false,
        advanceAmount: editEntry.advanceAmount,
        advanceChinaPerson: editEntry.advanceChinaPerson ?? '',
        advanceDate: editEntry.advanceDate ? new Date(editEntry.advanceDate) : undefined,
        advanceNote: editEntry.advanceNote ?? '',
        carryingRate: editEntry.carryingRate,
        avgRmbRate: editEntry.avgRmbRate,
        chinaWarehouseReceived: editEntry.chinaWarehouseReceived,
        chinaWarehouseCtn: editEntry.chinaWarehouseCtn,
        inTransitCtn: editEntry.inTransitCtn,
      })
    } else if (open && !editEntry) {
      setPrefillMessage(null)
      reset({
        mark: '',
        entryDate: new Date(),
        totalCtn: undefined,
        qty: undefined,
        rate: undefined,
        cbm: undefined,
        weight: undefined,
        hasAdvancePayment: false,
        advanceAmount: undefined,
        advanceChinaPerson: '',
        advanceDate: undefined,
        advanceNote: '',
        carryingRate: undefined,
        avgRmbRate: undefined,
        chinaWarehouseReceived: 'no',
        chinaWarehouseCtn: undefined,
        inTransitCtn: undefined,
      })
    }
  }, [open, editEntry, reset])

  // Prefill from last buying entry when adding (not editing)
  useEffect(() => {
    if (!open || editEntry || !productId) return
    const prefillFromLast = async () => {
      try {
        const res = await apiGet<{
          entry: { qty?: number; rate?: number; cbm?: number; weight?: number; carryingRate?: number; avgRmbRate?: number } | null
        }>(`/api/buying-entries/last?productId=${productId}`)
        if (res.success && res.data?.entry) {
          const last = res.data.entry
          if (last.qty != null) setValue('qty', last.qty)
          if (last.rate != null) setValue('rate', last.rate)
          if (last.cbm != null) setValue('cbm', last.cbm)
          if (last.weight != null) setValue('weight', last.weight)
          if (last.carryingRate != null) setValue('carryingRate', last.carryingRate)
          if (last.avgRmbRate != null) setValue('avgRmbRate', last.avgRmbRate)
          setPrefillMessage('Fields pre-filled from last entry.')
        }
      } catch {
        // No previous entry or error — leave fields empty
      }
    }
    prefillFromLast()
  }, [open, editEntry, productId, setValue])

  useEffect(() => {
    if (!open) return
    const total = watchTotalCtn ?? 0
    const chinaWarehouse =
      watched.chinaWarehouseReceived === 'yes'
        ? (watchChinaWarehouseCtn ?? 0)
        : 0
    const inTransit = watchInTransitCtn ?? 0
    const available = total - chinaWarehouse - inTransit

    // Clamp at 0 for display purposes
    // (real availableCtn is recomputed on backend from submitted values)
    const clamped = Math.max(0, available)
    // We don't have an explicit availableCtn field in the form,
    // but this keeps derived calculations consistent if needed later.
    if (!Number.isNaN(clamped)) {
      // no-op write to trigger dirty state if we ever add field
    }

    if (chinaWarehouse + inTransit > total) {
      setCtnWarning('China Warehouse CTN + In Transit CTN cannot exceed Total CTN')
    } else {
      setCtnWarning(null)
    }
  }, [open, watchTotalCtn, watchChinaWarehouseCtn, watchInTransitCtn])

  async function onSubmit(values: FormValues) {
    if (isEdit && (values.totalCtn ?? 0) < soldCtn) {
      toast.error(`Cannot reduce Total CTN below ${soldCtn} (already sold)`)
      return
    }
    const payload = {
      product: productId,
      mark: values.mark.trim(),
      entryDate: values.entryDate.toISOString(),
      totalCtn: values.totalCtn ?? 0,
      qty: values.qty ?? 0,
      rate: values.rate ?? 0,
      cbm: values.cbm ?? 0,
      weight: values.weight ?? 0,
      hasAdvancePayment: values.hasAdvancePayment,
      advanceAmount: values.hasAdvancePayment ? (values.advanceAmount ?? null) : null,
      advanceChinaPerson: values.hasAdvancePayment && values.advanceChinaPerson ? values.advanceChinaPerson : null,
      advanceDate: values.hasAdvancePayment && values.advanceDate ? values.advanceDate.toISOString() : null,
      advanceNote: values.hasAdvancePayment ? (values.advanceNote ?? null) : null,
      carryingRate: values.carryingRate,
      avgRmbRate: values.avgRmbRate,
      chinaWarehouseReceived: values.chinaWarehouseReceived,
      chinaWarehouseCtn:
        values.chinaWarehouseReceived === 'yes'
          ? values.chinaWarehouseCtn ?? 0
          : values.totalCtn ?? 0,
      inTransitCtn:
        values.chinaWarehouseReceived === 'yes'
          ? values.inTransitCtn ?? 0
          : 0,
    }
    if (isEdit) {
      const result = await apiPut(`/api/buying-entries/${editEntry._id}`, payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Entry updated')
      const canLock =
        values.chinaWarehouseReceived === 'yes' &&
        !editEntry?.isLocked &&
        (editEntry?.totalCtn ?? 0) > 0 &&
        (values.avgRmbRate ?? 0) > 0 &&
        (values.carryingRate ?? 0) > 0
      if (canLock) {
        setPendingLockAfterSave({
          entryId: editEntry._id,
          chinaWarehouseCtn: payload.chinaWarehouseCtn ?? 0,
          inTransitCtn: payload.inTransitCtn ?? 0,
        })
        return
      }
    } else {
      const result = await apiPost('/api/buying-entries', payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Entry created')
    }
    onOpenChange(false)
    onSuccess()
  }

  async function handleLockNow() {
    if (!pendingLockAfterSave) return
    setLockSubmitting(true)
    const result = await apiPost(`/api/buying-entries/${pendingLockAfterSave.entryId}/lock`, {
      chinaWarehouseCtn: pendingLockAfterSave.chinaWarehouseCtn,
      inTransitCtn: pendingLockAfterSave.inTransitCtn,
    })
    setLockSubmitting(false)
    setPendingLockAfterSave(null)
    onOpenChange(false)
    onSuccess()
    if (result.success) {
      toast.success((result as { message?: string }).message ?? 'Entry locked')
    } else {
      toast.error((result as { message?: string }).message ?? 'Failed to lock')
    }
  }

  function handleLockLater() {
    setPendingLockAfterSave(null)
    onOpenChange(false)
    onSuccess()
  }

  return (
    <>
      <AlertDialog
        open={!!pendingLockAfterSave}
        onOpenChange={(open) => {
          if (!open) handleLockLater()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Entry updated. China Warehouse Received is Yes. Would you like to lock the entry now to confirm cost and update China Bank?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleLockLater}>Later</AlertDialogCancel>
            <Button onClick={handleLockNow} disabled={lockSubmitting}>
              {lockSubmitting ? 'Locking…' : 'Lock now'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto w-[75vw] max-w-[75vw] p-6">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Buying Entry' : 'Add Buying Entry'}</SheetTitle>
        </SheetHeader>
        {prefillMessage && !isEdit && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded px-3 py-2 mt-4 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-200">
            <Info className="h-3 w-3 shrink-0" />
            <span>Fields pre-filled from your last buying entry. Update as needed.</span>
            <button
              type="button"
              onClick={() => setPrefillMessage(null)}
              className="ml-auto text-muted-foreground hover:text-foreground p-0.5 rounded"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
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
            {isEdit && soldCtn > 0 && (
              <div className="col-span-1 sm:col-span-2 lg:col-span-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:bg-blue-950/30 dark:border-blue-800">
                  <p className="text-blue-700 dark:text-blue-200">
                    {soldCtn} CTN already sold from this entry. Editing cost fields will automatically recalculate profits on all related sell bills.
                  </p>
                </div>
              </div>
            )}

            {/* Row 1: Mark full width */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-2">
              <Label htmlFor="mark">Mark *</Label>
              <Input
                id="mark"
                placeholder="Enter mark (e.g. A1, B2, LOT-001)"
                {...register('mark')}
                className={errors.mark ? 'border-destructive' : ''}
              />
              {errors.mark && <p className="text-sm text-destructive">{errors.mark.message}</p>}
            </div>

            {/* Row 2: Entry Date | Total CTN | QTY per CTN | Rate */}
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
                  <Calendar
                    mode="single"
                    selected={watched.entryDate}
                    onSelect={(d) => d && setValue('entryDate', d)}
                  />
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
                    onChange={(val) => {
                      field.onChange(val)
                      if (isEdit && soldCtn > 0 && val != null && val < soldCtn) {
                        setTotalCtnError(
                          `Cannot be less than ${Math.ceil(soldCtn)} CTN (${soldCtn} CTN already sold)`
                        )
                      } else {
                        setTotalCtnError(null)
                      }
                    }}
                    decimal={isEdit}
                    step={isEdit ? 0.01 : undefined}
                    className={errors.totalCtn || totalCtnError ? 'border-destructive' : ''}
                  />
                )}
              />
              {errors.totalCtn && <p className="text-sm text-destructive">{errors.totalCtn.message}</p>}
              {totalCtnError && <p className="text-xs text-destructive mt-1">⚠️ {totalCtnError}</p>}
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
                    decimal={false}
                    className={errors.qty ? 'border-destructive' : ''}
                  />
                )}
              />
              {errors.qty && <p className="text-sm text-destructive">{errors.qty.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate">Rate (¥ per piece) *</Label>
              <Controller
                name="rate"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="rate"
                    placeholder="Enter rate"
                    prefix="¥"
                    value={field.value}
                    onChange={field.onChange}
                    className={errors.rate ? 'border-destructive' : ''}
                  />
                )}
              />
              {errors.rate && <p className="text-sm text-destructive">{errors.rate.message}</p>}
            </div>

            {/* Row 3: CBM | Weight | Carrying | Avg RMB */}
            <div className="space-y-2">
              <Label htmlFor="cbm">CBM per CTN *</Label>
              <Controller
                name="cbm"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="cbm"
                    placeholder="Enter CBM"
                    value={field.value}
                    onChange={field.onChange}
                    className={errors.cbm ? 'border-destructive' : ''}
                  />
                )}
              />
              {errors.cbm && <p className="text-sm text-destructive">{errors.cbm.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">Weight per CTN *</Label>
              <Controller
                name="weight"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="weight"
                    placeholder="Enter weight"
                    value={field.value}
                    onChange={field.onChange}
                    className={errors.weight ? 'border-destructive' : ''}
                  />
                )}
              />
              {errors.weight && <p className="text-sm text-destructive">{errors.weight.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="carryingRate">Carrying Rate</Label>
              <Controller
                name="carryingRate"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="carryingRate"
                    placeholder="Enter carrying rate"
                    value={field.value}
                    onChange={field.onChange}
                    decimal={false}
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avgRmbRate">Avg RMB Rate</Label>
              <Controller
                name="avgRmbRate"
                control={control}
                render={({ field }) => (
                  <NumberInput
                    id="avgRmbRate"
                    placeholder="Enter RMB rate"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
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
                            e.stopPropagation()
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

            {/* Row 5 & 6: advance fields when checked */}
            {watched.hasAdvancePayment && (
              <>
                <div className="space-y-2">
                  <Label>China Person</Label>
                  <Controller
                    name="advanceChinaPerson"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger
                          className={cn(
                            errors.advanceChinaPerson && 'border-destructive'
                          )}
                        >
                          <SelectValue placeholder="Select China Person (e.g. Sophia)" />
                        </SelectTrigger>
                        <SelectContent>
                          {chinaPersons.map((p) => (
                            <SelectItem key={p._id} value={p._id}>
                              {p.name} (¥{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(p.currentBalance)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.advanceChinaPerson && (
                    <p className="text-xs text-destructive mt-1">
                      ⚠️ {errors.advanceChinaPerson.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="advanceAmount">Advance Amount (¥)</Label>
                  <Controller
                    name="advanceAmount"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="advanceAmount"
                        placeholder="Enter advance amount"
                        prefix="¥"
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
                      <Calendar
                        mode="single"
                        selected={watched.advanceDate}
                        onSelect={(d) => setValue('advanceDate', d)}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-2">
                  <Label htmlFor="advanceNote">Advance Note (optional)</Label>
                  <Input id="advanceNote" {...register('advanceNote')} placeholder="Optional note" />
                </div>
              </>
            )}

            {/* Row 7: China Warehouse Received full width */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-2">
              <Label>China Warehouse Received</Label>
              <Select
                value={watched.chinaWarehouseReceived}
                onValueChange={(v: 'yes' | 'no') => setValue('chinaWarehouseReceived', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 8: China / Transit / Available / Sold (if Yes) */}
            {watched.chinaWarehouseReceived === 'yes' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="chinaWarehouseCtn">China Warehouse CTN</Label>
                  <Controller
                    name="chinaWarehouseCtn"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="chinaWarehouseCtn"
                        placeholder="Enter CTN in China warehouse"
                        value={field.value}
                        onChange={field.onChange}
                        decimal={false}
                        min={0}
                        className={ctnWarning ? 'border-destructive' : ''}
                      />
                    )}
                  />
                  {errors.chinaWarehouseCtn && (
                    <p className="text-sm text-destructive">{errors.chinaWarehouseCtn.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inTransitCtn">In Transit CTN</Label>
                  <Controller
                    name="inTransitCtn"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="inTransitCtn"
                        placeholder="Enter CTN in transit"
                        value={field.value}
                        onChange={field.onChange}
                        decimal={false}
                        min={0}
                        className={ctnWarning ? 'border-destructive' : ''}
                      />
                    )}
                  />
                  {errors.inTransitCtn && (
                    <p className="text-sm text-destructive">{errors.inTransitCtn.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Available CTN (India)</Label>
                  <div className="rounded-md border bg-muted px-3 py-2 text-sm">
                    {(() => {
                      const total = (watched.totalCtn as number | undefined) ?? 0
                      const china = (watched.chinaWarehouseCtn as number | undefined) ?? 0
                      const transit = (watched.inTransitCtn as number | undefined) ?? 0
                      const sold = isEdit ? (editEntry?.soldCtn ?? 0) : 0
                      const available = parseFloat(
                        Math.max(0, total - china - transit - sold).toFixed(2)
                      )
                      return (
                        <span
                          className={
                            available < 0
                              ? 'text-destructive font-semibold'
                              : 'font-semibold'
                          }
                        >
                          {Number.isFinite(available) ? available : 0}
                        </span>
                      )
                    })()}
                  </div>
                  {ctnWarning && (
                    <p className="text-xs text-destructive">{ctnWarning}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Sold CTN</Label>
                  <div className="rounded-md border bg-muted px-3 py-2 text-sm">
                    <span className="font-semibold">
                      {isEdit ? (editEntry?.soldCtn ?? 0) : 0}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Row 9: Auto-calculated summary panel full width */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4">
              <AutoCalculatedFields
                totalCtn={watched.totalCtn}
                qty={watched.qty}
                rate={watched.rate}
                cbm={watched.cbm}
                weight={watched.weight}
                givenAmountDisplay={
                  isEdit
                    ? (editEntry?.givenAmount ?? 0)
                    : watched.hasAdvancePayment
                      ? (watched.advanceAmount ?? 0)
                      : 0
                }
                hasAdvancePayment={watched.hasAdvancePayment}
                advanceAmount={watched.advanceAmount}
                carryingRate={watched.carryingRate}
                avgRmbRate={watched.avgRmbRate}
              />
            </div>

            {/* Row 10: Buttons */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-4 flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  (watched.chinaWarehouseReceived === 'yes' &&
                    (() => {
                      const total = (watched.totalCtn as number | undefined) ?? 0
                      const china = (watched.chinaWarehouseCtn as number | undefined) ?? 0
                      const transit = (watched.inTransitCtn as number | undefined) ?? 0
                      return total - china - transit < 0
                    })())
                }
              >
                {isEdit ? (isSubmitting ? 'Saving…' : 'Update') : isSubmitting ? 'Saving…' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
    </>
  )
}
