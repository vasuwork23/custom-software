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
    const payload = {
      companyName: values.companyName.trim(),
      ownerName: values.ownerName?.trim() || undefined,
      contact1Name: values.contact1Name?.trim() || undefined,
      contact1Mobile: values.contact1Mobile?.trim() || undefined,
      contact2Name: values.contact2Name?.trim() || undefined,
      contact2Mobile: values.contact2Mobile?.trim() || undefined,
      gstNumber: values.gstNumber?.trim() || undefined,
      address: values.address?.trim() || undefined,
      city: values.city?.trim() || undefined,
      primaryMobile: values.primaryMobile?.trim() || undefined,
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

  function useContactForWhatsapp(which: 'contact1' | 'contact2') {
    const source = which === 'contact1' ? contact1Mobile : contact2Mobile
    if (source && source.trim()) {
      setValue('primaryMobile', source.trim(), { shouldValidate: true })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Company' : 'Add Company'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-6">
          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="ownerName">Owner Name</Label>
            <Input id="ownerName" {...register('ownerName')} placeholder="Optional" />
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <div className="font-medium text-sm text-muted-foreground">Contact 1</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact1Name">Name</Label>
                <Input id="contact1Name" {...register('contact1Name')} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact1Mobile">Mobile</Label>
                <Input id="contact1Mobile" {...register('contact1Mobile')} placeholder="Optional" />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <div className="font-medium text-sm text-muted-foreground">Contact 2</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact2Name">Name</Label>
                <Input id="contact2Name" {...register('contact2Name')} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact2Mobile">Mobile</Label>
                <Input id="contact2Mobile" {...register('contact2Mobile')} placeholder="Optional" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gstNumber">GST Number</Label>
            <Input id="gstNumber" {...register('gstNumber')} placeholder="Optional" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" {...register('address')} placeholder="Optional" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" {...register('city')} placeholder="Optional" />
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <Label htmlFor="primaryMobile">
                  WhatsApp Number <span className="ml-1">🟢</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  This number will be used for sending bills and outstanding reminders.
                </p>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!contact1Mobile}
                  onClick={() => useContactForWhatsapp('contact1')}
                >
                  Same as Contact 1
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!contact2Mobile}
                  onClick={() => useContactForWhatsapp('contact2')}
                >
                  Same as Contact 2
                </Button>
              </div>
            </div>
            <Input
              id="primaryMobile"
              {...register('primaryMobile')}
              placeholder="WhatsApp mobile (with or without country code)"
            />
          </div>

          <div className="flex gap-2 pt-4">
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
