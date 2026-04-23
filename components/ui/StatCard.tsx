import * as React from 'react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  value: React.ReactNode
  icon?: LucideIcon
  trend?: {
    value: number
    label: string
    positive?: boolean
  }
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ title, value, icon: Icon, trend, className, ...props }, ref) => (
    <Card ref={ref} className={cn('', className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {trend && (
          <p
            className={cn(
              'text-xs text-muted-foreground mt-1',
              trend.positive === true && 'text-emerald-600 dark:text-emerald-400',
              trend.positive === false && 'text-destructive'
            )}
          >
            {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  )
)
StatCard.displayName = 'StatCard'

export { StatCard }
