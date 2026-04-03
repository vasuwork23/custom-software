'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiGet, apiPost, apiPut } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function formatInr(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

export interface ExpenseFormValues {
  _id: string
  title: string
  amount: number
  paidFromId: string
  paidFromName: string
  expenseDate: string
  remark?: string
}

interface ExpenseFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editExpense: ExpenseFormValues | null
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  onSuccess,
  editExpense,
}: ExpenseFormDialogProps) {
  const [paidFromOptions, setPaidFromOptions] = useState<SearchableSelectOption<string>[]>([])
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [paidFromId, setPaidFromId] = useState('')
  const [expenseDate, setExpenseDate] = useState<Date>(new Date())
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchBanks = useCallback(async () => {
    const res = await apiGet<{ accounts: { _id: string; accountName: string; type: string; currentBalance: number }[] }>('/api/banks')
    if (res.success) {
      const options = res.data.accounts.map((a) => ({
        value: a._id,
        label: `${a.accountName} — ₹${formatInr(a.currentBalance ?? 0)}`,
      }))
      setPaidFromOptions(options)
    }
  }, [])

  useEffect(() => {
    if (open) fetchBanks()
  }, [open, fetchBanks])

  useEffect(() => {
    if (!open) return
    if (editExpense) {
      setTitle(editExpense.title)
      setAmount(editExpense.amount)
      setPaidFromId(editExpense.paidFromId)
      setExpenseDate(editExpense.expenseDate ? new Date(editExpense.expenseDate) : new Date())
      setRemark(editExpense.remark ?? '')
    } else {
      setTitle('')
      setAmount(undefined)
      setPaidFromId('')
      setExpenseDate(new Date())
      setRemark('')
    }
  }, [open, editExpense])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const numAmount = amount ?? 0
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!paidFromId) {
      toast.error('Select Paid From account')
      return
    }
    setSubmitting(true)
    const payload = {
      title: title.trim(),
      amount: numAmount,
      paidFrom: paidFromId,
      expenseDate: format(expenseDate, 'yyyy-MM-dd'),
      remark: remark.trim() || undefined,
    }
    if (editExpense) {
      const result = await apiPut(`/api/expenses/${editExpense._id}`, payload)
      setSubmitting(false)
      if (result.success) {
        toast.success('Expense updated')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    } else {
      const result = await apiPost<{ _id: string; balanceWarning?: boolean }>('/api/expenses', payload)
      setSubmitting(false)
      if (result.success) {
        if (result.data.balanceWarning) toast.warning('Account balance will go negative after this expense.')
        toast.success('Expense added')
        onOpenChange(false)
        onSuccess()
      } else toast.error(result.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editExpense ? 'Edit Expense' : 'Add Expense'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="expense-title">Title</Label>
            <Input
              id="expense-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Office Rent"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-amount">Amount (₹)</Label>
            <NumberInput
              id="expense-amount"
              placeholder="Enter amount"
              prefix="₹"
              value={amount}
              onChange={setAmount}
              min={0.01}
            />
          </div>
          <div className="space-y-2">
            <Label>Paid From</Label>
            <SearchableSelect
              options={paidFromOptions}
              value={paidFromId}
              onValueChange={setPaidFromId}
              placeholder="Select account (Cash or bank)"
              emptyText="No accounts. Add bank accounts in Our Banks."
            />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(expenseDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={expenseDate} onSelect={(d) => d && setExpenseDate(d)} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-remark">Remark (optional)</Label>
            <Input
              id="expense-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : editExpense ? 'Update' : 'Add Expense'}
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
