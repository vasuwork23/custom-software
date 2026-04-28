'use client'

import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'

const schema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  ownerName: z.string().optional(),
  openingBalance: z.string().optional(),
  openingBalanceNotes: z.string().optional(),
  contact1Name: z.string().optional(),
  contact1Mobile: z.string().optional(),
  contact2Name: z.string().optional(),
  contact2Mobile: z.string().optional(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  primaryMobile: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export interface CompanyFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editCompany?: {
    _id: string
    companyName: string
    ownerName?: string
    openingBalance?: number
    openingBalanceNotes?: string
    contact1Name?: string
    contact1Mobile?: string
    contact2Name?: string
    contact2Mobile?: string
    gstNumber?: string
    address?: string
    city?: string
    primaryMobile?: string
  } | null
}

export function CompanyFormSheet({
  open,
  onOpenChange,
  onSuccess,
  editCompany,
}: CompanyFormSheetProps) {
  const isEdit = !!editCompany

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: '',
      ownerName: '',
      openingBalance: '',
      openingBalanceNotes: '',
      contact1Name: '',
      contact1Mobile: '',
      contact2Name: '',
      contact2Mobile: '',
      gstNumber: '',
      address: '',
      city: '',
      primaryMobile: '',
    },
  })

  useEffect(() => {
    if (open && editCompany) {
      reset({
        companyName: editCompany.companyName,
        ownerName: editCompany.ownerName ?? '',
        openingBalance: editCompany.openingBalance !== undefined ? String(editCompany.openingBalance) : '',
        openingBalanceNotes: editCompany.openingBalanceNotes ?? '',
        contact1Name: editCompany.contact1Name ?? '',
        contact1Mobile: editCompany.contact1Mobile ?? '',
        contact2Name: editCompany.contact2Name ?? '',
        contact2Mobile: editCompany.contact2Mobile ?? '',
        gstNumber: editCompany.gstNumber ?? '',
        address: editCompany.address ?? '',
        city: editCompany.city ?? '',
        primaryMobile: editCompany.primaryMobile ?? '',
      })
    } else if (open && !editCompany) {
      reset({
        companyName: '',
        ownerName: '',
        openingBalance: '',
        openingBalanceNotes: '',
        contact1Name: '',
        contact1Mobile: '',
        contact2Name: '',
        contact2Mobile: '',
        gstNumber: '',
        address: '',
        city: '',
        primaryMobile: '',
      })
    }
  }, [open, editCompany, reset])

  async function onSubmit(values: FormValues) {
    const normalizeOptional = (value?: string) => {
      const trimmed = value?.trim() ?? ''
      return trimmed === '' ? null : trimmed
    }

    const payload = {
      companyName: values.companyName.trim(),
      ownerName: normalizeOptional(values.ownerName),
      openingBalance: values.openingBalance?.trim() ? Number(values.openingBalance) : 0,
      openingBalanceNotes: normalizeOptional(values.openingBalanceNotes),
      contact1Name: normalizeOptional(values.contact1Name),
      contact1Mobile: normalizeOptional(values.contact1Mobile),
      contact2Name: normalizeOptional(values.contact2Name),
      contact2Mobile: normalizeOptional(values.contact2Mobile),
      gstNumber: normalizeOptional(values.gstNumber),
      address: normalizeOptional(values.address),
      city: normalizeOptional(values.city),
      primaryMobile: normalizeOptional(values.primaryMobile),
    }
    if (isEdit) {
      const result = await apiPut(`/api/companies/${editCompany._id}`, payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Company updated')
    } else {
      const result = await apiPost('/api/companies', payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success('Company created')
    }
    onOpenChange(false)
    onSuccess()
  }

  const contact1Mobile = watch('contact1Mobile')
  const contact2Mobile = watch('contact2Mobile')

  function setContactForWhatsapp(which: 'contact1' | 'contact2') {
    const source = which === 'contact1' ? contact1Mobile : contact2Mobile
    if (source && source.trim()) {
      setValue('primaryMobile', source.trim(), { shouldValidate: true })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full min-w-0 w-[70vw] max-w-[70vw] flex-col overflow-y-auto overflow-x-hidden p-4 pb-6 pr-14 sm:max-w-[70vw] sm:p-6 sm:pr-14"
      >
        <SheetHeader className="shrink-0 space-y-1 pb-3 pr-2">
          <SheetTitle>{isEdit ? 'Edit Company' : 'Add Company'}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-w-0 flex-1 flex-col gap-2.5"
        >
          <div className="min-w-0 space-y-2.5">
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  {...register('companyName')}
                  className={errors.companyName ? 'border-destructive' : ''}
                  placeholder="Company name"
                />
                {errors.companyName && (
                  <p className="text-sm text-destructive">{errors.companyName.message}</p>
                )}
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="ownerName">Owner Name</Label>
                <Input id="ownerName" {...register('ownerName')} placeholder="Optional" />
              </div>
            </div>

            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="openingBalance">Opening Balance (₹)</Label>
                <Input id="openingBalance" {...register('openingBalance')} type="number" step="any" placeholder="Optional" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="openingBalanceNotes">Opening Balance Notes</Label>
                <Input id="openingBalanceNotes" {...register('openingBalanceNotes')} placeholder="Optional" />
              </div>
            </div>

            <div className="grid min-w-0 gap-2.5 lg:grid-cols-2">
              <div className="min-w-0 space-y-2 rounded-lg border p-2.5">
                <div className="text-sm font-medium text-muted-foreground">Contact 1</div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="contact1Name">Name</Label>
                    <Input id="contact1Name" {...register('contact1Name')} placeholder="Optional" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="contact1Mobile">Mobile</Label>
                    <Input id="contact1Mobile" {...register('contact1Mobile')} placeholder="Optional" />
                  </div>
                </div>
              </div>
              <div className="min-w-0 space-y-2 rounded-lg border p-2.5">
                <div className="text-sm font-medium text-muted-foreground">Contact 2</div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="contact2Name">Name</Label>
                    <Input id="contact2Name" {...register('contact2Name')} placeholder="Optional" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="contact2Mobile">Mobile</Label>
                    <Input id="contact2Mobile" {...register('contact2Mobile')} placeholder="Optional" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="gstNumber">GST Number</Label>
                <Input id="gstNumber" {...register('gstNumber')} placeholder="Optional" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" {...register('city')} placeholder="Optional" />
              </div>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...register('address')} placeholder="Optional" />
            </div>

            <div className="min-w-0 rounded-lg border p-2.5">
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="primaryMobile">
                    WhatsApp Number <span className="ml-1">🟢</span>
                  </Label>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Used for bills and outstanding reminders.
                  </p>
                </div>
                <Input
                  id="primaryMobile"
                  className="w-full min-w-0"
                  {...register('primaryMobile')}
                  placeholder="WhatsApp mobile (with or without country code)"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!contact1Mobile}
                    onClick={() => setContactForWhatsapp('contact1')}
                  >
                    Same as Contact 1
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!contact2Mobile}
                    onClick={() => setContactForWhatsapp('contact2')}
                  >
                    Same as Contact 2
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 border-t pt-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
