'use client'

import { useState, useEffect } from 'react'
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
import { apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Mode = 'pay_in' | 'pay_out'

interface PayInOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  personId: string
  personName: string
  mode: Mode
}

export function PayInOutDialog({
  open,
  onOpenChange,
  onSuccess,
  personId,
  personName,
  mode,
}: PayInOutDialogProps) {
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [transactionDate, setTransactionDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount(undefined)
      setTransactionDate(new Date())
      setNotes('')
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = amount ?? 0
    if (!Number.isFinite(num) || num <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSubmitting(true)
    const path = mode === 'pay_in' ? 'pay-in' : 'pay-out'
    const result = await apiPost<{ balanceAfter: number; balanceWarning?: boolean }>(
      `/api/sophia/${personId}/${path}`,
      {
        amount: num,
        transactionDate: format(transactionDate, 'yyyy-MM-dd'),
        notes: notes.trim() || undefined,
      }
    )
    setSubmitting(false)
    if (result.success) {
      if (result.data?.balanceWarning) toast.warning('Balance will be negative.')
      toast.success(mode === 'pay_in' ? 'Pay In recorded' : 'Pay Out recorded')
      onOpenChange(false)
      onSuccess()
    } else toast.error(result.message)
  }

  const title = mode === 'pay_in' ? `Pay In — ${personName}` : `Pay Out — ${personName}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (¥ RMB)</Label>
            <NumberInput
              id="amount"
              placeholder="Enter amount"
              prefix="¥"
              value={amount}
              onChange={setAmount}
              min={0.01}
            />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(transactionDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={transactionDate}
                  onSelect={(d) => d && setTransactionDate(d)}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : mode === 'pay_in' ? 'Pay In' : 'Pay Out'}
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
