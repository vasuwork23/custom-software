import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode
  description?: React.ReactNode
  breadcrumb?: React.ReactNode
  action?: React.ReactNode
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, breadcrumb, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between', className)}
      {...props}
    >
      <div className="space-y-1">
        {breadcrumb && (
          <nav className="text-sm text-muted-foreground">{breadcrumb}</nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-2 shrink-0 sm:mt-0">{action}</div>}
    </div>
  )
)
PageHeader.displayName = 'PageHeader'

export { PageHeader }
