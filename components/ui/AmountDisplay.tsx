import { cn } from '@/lib/utils'

export type Currency = 'INR' | 'RMB'

const symbols: Record<Currency, string> = {
  INR: '₹',
  RMB: '¥',
}

export interface AmountDisplayProps {
  amount: number
  currency?: Currency
  className?: string
  showSign?: boolean
  decimals?: number
}

export function AmountDisplay({
  amount,
  currency = 'INR',
  className,
  showSign = false,
  decimals = 2,
}: AmountDisplayProps) {
  const isNegative = amount < 0
  const symbol = symbols[currency]
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(Math.abs(amount))
  const sign = showSign && amount !== 0 ? (amount > 0 ? '+' : '-') : ''

  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        isNegative && 'text-destructive',
        className
      )}
    >
      {sign}
      {symbol}
      {formatted}
    </span>
  )
}
