'use client'

import { cn } from '@/lib/utils'

interface RevenueExclusionToggleProps {
  /** Companies flagged "Exclude from revenue" — the toggle hides when there are none */
  companies?: { id: string; name: string }[]
  included: boolean
  onChange: (included: boolean) => void
  /** Switch only, no label text — the tooltip explains it */
  compact?: boolean
  className?: string
}

/** Puts companies flagged "Exclude from revenue" back into Revenue / Cost. Profit counts either way. */
export function RevenueExclusionToggle({ companies, included, onChange, compact, className }: RevenueExclusionToggleProps) {
  if (!companies || companies.length === 0) return null
  const names = companies.map((c) => c.name).join(', ')
  return (
    <button
      type="button"
      role="switch"
      aria-checked={included}
      onClick={() => onChange(!included)}
      className={cn('inline-flex items-center gap-2 text-xs sm:text-sm', className)}
      aria-label={`Include ${names} in revenue`}
      title={
        included
          ? `${names} is included in Revenue and Cost — click to leave it out`
          : `${names} is left out of Revenue and Cost (its profit still counts) — click to include it`
      }
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          included ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
            included ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </span>
      {!compact && (
        <span className="text-left text-muted-foreground">
          Include <span className="font-medium text-foreground">{names}</span> in revenue
        </span>
      )}
    </button>
  )
}
