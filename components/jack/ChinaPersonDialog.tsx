'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'

interface ChinaPersonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editPerson: { _id: string; name: string } | null
}

export function ChinaPersonDialog({
  open,
  onOpenChange,
  onSuccess,
  editPerson,
}: ChinaPersonDialogProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(editPerson?.name ?? '')
  }, [open, editPerson])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name is required')
      return
    }
    setSubmitting(true)
    if (editPerson) {
      const result = await apiPut(`/api/sophia/${editPerson._id}`, { name: trimmed })
      setSubmitting(false)
      if (result.success) {
        toast.success('Updated')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    } else {
      const result = await apiPost('/api/sophia', { name: trimmed })
      setSubmitting(false)
      if (result.success) {
        toast.success('China person added')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editPerson ? 'Edit China Person' : 'Add China Person'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="jack-name">Name</Label>
            <Input
              id="jack-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Person name"
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : editPerson ? 'Update' : 'Add'}
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
