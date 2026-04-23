import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from '@/components/ui/badge'

export type StatusVariant =
  | 'active'
  | 'inactive'
  | 'paid'
  | 'unpaid'
  | 'partiallypaid'
  | 'credit'
  | 'debit'
  | 'reversal'
  | 'cash'
  | 'online'
  | 'pay_in'
  | 'pay_out'
  | 'success'
  | 'warning'
  | 'error'
  | 'default'

const variantMap: Record<StatusVariant, BadgeProps['variant']> = {
  active: 'success',
  inactive: 'secondary',
  paid: 'success',
  unpaid: 'destructive',
  partiallypaid: 'warning',
  credit: 'success',
  debit: 'destructive',
  reversal: 'warning',
  cash: 'secondary',
  online: 'outline',
  pay_in: 'success',
  pay_out: 'destructive',
  success: 'success',
  warning: 'warning',
  error: 'destructive',
  default: 'secondary',
}

const labelMap: Record<StatusVariant, string> = {
  active: 'Active',
  inactive: 'Inactive',
  paid: 'Paid',
  unpaid: 'Unpaid',
  partiallypaid: 'Partially Paid',
  credit: 'Credit',
  debit: 'Debit',
  reversal: 'Reversal',
  cash: 'Cash',
  online: 'Online',
  pay_in: 'Pay In',
  pay_out: 'Pay Out',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  default: '—',
}

export interface StatusBadgeProps {
  status: StatusVariant | string
  className?: string
  label?: string
}

export function StatusBadge({ status, className, label }: StatusBadgeProps) {
  const variant = variantMap[status as StatusVariant] ?? 'secondary'
  const displayLabel = label ?? labelMap[status as StatusVariant] ?? status

  return (
    <Badge variant={variant} className={cn('capitalize', className)}>
      {displayLabel}
    </Badge>
  )
}
