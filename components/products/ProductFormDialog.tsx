'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const schema = z.object({
  productName: z.string().min(1, 'Product name is required'),
  productDescription: z.string().optional(),
  productImage: z.string().url().optional().or(z.literal('')),
  ctnWeightKg: z.string().optional(),
  ctnCbm: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export interface ProductFormSubmitValues {
  productName: string
  productDescription?: string
  productImage?: string
  ctnWeightKg: number | null
  ctnCbm: number | null
}

function toMeasure(v?: string): number | null {
  const n = Number(v)
  return v?.trim() && Number.isFinite(n) && n > 0 ? n : null
}

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ProductFormSubmitValues) => Promise<void>
  initialValues?: {
    productName: string
    productDescription?: string
    productImage?: string
    ctnWeightKg?: number | null
    ctnCbm?: number | null
  } | null
  title: string
  submitLabel?: string
}

export function ProductFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialValues,
  title,
  submitLabel = 'Save',
}: ProductFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { productName: '', productDescription: '', productImage: '', ctnWeightKg: '', ctnCbm: '' },
  })

  useEffect(() => {
    if (open) {
      reset({
        productName: initialValues?.productName ?? '',
        productDescription: initialValues?.productDescription ?? '',
        productImage: initialValues?.productImage ?? '',
        ctnWeightKg: initialValues?.ctnWeightKg ? String(initialValues.ctnWeightKg) : '',
        ctnCbm: initialValues?.ctnCbm ? String(initialValues.ctnCbm) : '',
      })
    }
  }, [open, initialValues, reset])

  async function handleFormSubmit(values: FormValues) {
    await onSubmit({
      productName: values.productName.trim(),
      productDescription: values.productDescription?.trim() || undefined,
      productImage: values.productImage?.trim() || undefined,
      ctnWeightKg: toMeasure(values.ctnWeightKg),
      ctnCbm: toMeasure(values.ctnCbm),
    })
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="productName">Product Name *</Label>
            <Input
              id="productName"
              {...register('productName')}
              className={errors.productName ? 'border-destructive' : ''}
              placeholder="e.g. Widget A"
            />
            {errors.productName && (
              <p className="text-sm text-destructive">{errors.productName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="productDescription">Description</Label>
            <Textarea
              id="productDescription"
              {...register('productDescription')}
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="productImage">Image URL</Label>
            <Input
              id="productImage"
              type="url"
              {...register('productImage')}
              placeholder="https://..."
            />
            {errors.productImage && (
              <p className="text-sm text-destructive">{errors.productImage.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ctnWeightKg">Weight per CTN (kg)</Label>
              <Input id="ctnWeightKg" type="number" step="any" min="0" {...register('ctnWeightKg')} placeholder="e.g. 18.5" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ctnCbm">CBM per CTN</Label>
              <Input id="ctnCbm" type="number" step="any" min="0" {...register('ctnCbm')} placeholder="e.g. 0.054" />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Optional. Used in Product Insights only when buying entries don&apos;t have weight / CBM.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
