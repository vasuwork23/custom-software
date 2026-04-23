'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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

const formSchema = z.object({
  inrAmount: z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z
      .number({ required_error: 'INR amount is required' })
      .positive('INR amount must be positive')
  ),
  sendToDestination: z.string().min(1, 'Select a destination'),
  notes: z.string().optional(),
  transactionDate: z.date(),
})

type FormValues = z.infer<typeof formSchema>

interface BankAccountOption {
  _id: string
  accountName: string
  currentBalance: number
  type: 'cash' | 'online'
}

interface WithdrawDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function WithdrawDialog({
  open,
  onOpenChange,
  onSuccess,
}: WithdrawDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([])

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      inrAmount: undefined,
      sendToDestination: '',
      notes: '',
      transactionDate: new Date(),
    },
  })

  const transactionDate = watch('transactionDate')
  const inrAmount = watch('inrAmount')
  const sendToDestination = watch('sendToDestination')

  useEffect(() => {
    if (!open) return
    ;(async () => {
      const res = await apiGet<{ accounts: BankAccountOption[] }>('/api/banks')
      if (res.success) {
        setBankAccounts(res.data.accounts)
      } else {
        toast.error(res.message)
      }
    })()
  }, [open])

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const payload = {
      inrAmount: values.inrAmount,
      sendToDestination: values.sendToDestination,
      date: format(values.transactionDate, 'yyyy-MM-dd'),
      note: values.notes || undefined,
    }
    const result = await apiPost('/api/china-bank/withdrawal', payload)
    setSubmitting(false)

    if (!result.success) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success('Transfer out recorded successfully')
    reset({
      inrAmount: undefined,
      sendToDestination: '',
      notes: '',
      transactionDate: new Date(),
    })
    onOpenChange(false)
    onSuccess()
  }

  const cashAccount = bankAccounts.find((a) => a.type === 'cash')
  const onlineAccounts = bankAccounts.filter((a) => a.type === 'online')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Out from China Bank</DialogTitle>
          <DialogDescription>
            This will debit China Bank and credit the selected account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Send To *</Label>
            <Controller
              name="sendToDestination"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccount && (
                      <SelectItem value="cash">
                        💵 Cash — ₹
                        {cashAccount.currentBalance.toLocaleString('en-IN')}
                      </SelectItem>
                    )}
                    {onlineAccounts.map((bank) => (
                      <SelectItem key={bank._id} value={bank._id}>
                        🏦 {bank.accountName} — ₹
                        {bank.currentBalance.toLocaleString('en-IN')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.sendToDestination && (
              <p className="text-xs text-destructive">
                {errors.sendToDestination.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>INR Amount (₹) *</Label>
            <Controller
              name="inrAmount"
              control={control}
              render={({ field }) => (
                <NumberInput
                  placeholder="Amount to transfer out"
                  prefix="₹"
                  value={field.value}
                  onChange={field.onChange}
                  min={0.01}
                />
              )}
            />
            {errors.inrAmount && (
              <p className="text-xs text-destructive">
                {errors.inrAmount.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Amount that will be debited from China Bank.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !transactionDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {transactionDate
                    ? format(transactionDate, 'PPP')
                    : 'Pick date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={transactionDate}
                  onSelect={(d) => d && setValue('transactionDate', d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <Input
                  placeholder="Transfer reference, purpose..."
                  {...field}
                />
              )}
            />
          </div>

          {inrAmount && sendToDestination && (
            <div className="bg-muted rounded p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit to account</span>
                <span className="text-green-600 font-medium">
                  +₹{Number(inrAmount).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">Debit from China Bank</span>
                <span className="text-red-600 font-medium">
                  -₹{Number(inrAmount).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Transferring…' : '↩ Transfer Out'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
