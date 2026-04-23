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
})

type FormValues = z.infer<typeof schema>

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: FormValues) => Promise<void>
  initialValues?: { productName: string; productDescription?: string; productImage?: string } | null
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
    defaultValues: { productName: '', productDescription: '', productImage: '' },
  })

  useEffect(() => {
    if (open) {
      reset({
        productName: initialValues?.productName ?? '',
        productDescription: initialValues?.productDescription ?? '',
        productImage: initialValues?.productImage ?? '',
      })
    }
  }, [open, initialValues, reset])

  async function handleFormSubmit(values: FormValues) {
    await onSubmit({
      productName: values.productName.trim(),
      productDescription: values.productDescription?.trim() || undefined,
      productImage: values.productImage?.trim() || undefined,
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
