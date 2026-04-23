'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface TableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
  showHeader?: boolean
}

export function TableSkeleton({
  rows = 5,
  columns = 5,
  className,
  showHeader = true,
}: TableSkeletonProps) {
  return (
    <div className={cn('rounded-md border', className)}>
      <table className="w-full table-fixed border-collapse text-sm">
        {showHeader && (
          <thead>
            <tr className="border-b bg-muted/50">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="p-3 text-left">
                  <Skeleton className="h-4 w-20" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b">
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} className="p-3">
                  <Skeleton className="h-4 w-full max-w-[120px]" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
