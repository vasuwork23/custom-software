'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface NumberInputProps {
  id?: string
  placeholder?: string
  prefix?: '₹' | '¥' | string
  value?: number
  onChange?: (value: number | undefined) => void
  disabled?: boolean
  readOnly?: boolean
  min?: number
  max?: number
  decimal?: boolean
  step?: number
  className?: string
  title?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}

function formatDisplayValue(value: number | undefined): string {
  if (value === undefined || value === null) return ''
  if (Number.isNaN(value)) return ''
  return String(value)
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      id,
      placeholder = 'Enter amount',
      prefix,
      value,
      onChange,
      disabled,
      readOnly,
      min,
      max,
      decimal = true,
      step,
      className,
      title,
      'aria-label': ariaLabel,
      'aria-invalid': ariaInvalid,
    },
    ref
  ) => {
    const [draft, setDraft] = React.useState<string | null>(null)

    React.useEffect(() => {
      setDraft(null)
    }, [value])

    const displayValue =
      draft !== null ? draft : (value === undefined || value === null ? '' : String(value))

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value

      // Allow only digits and at most one dot for decimal inputs
      if (decimal) {
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) {
          // Invalid character for decimal, ignore change
          return
        }
      } else {
        if (raw !== '' && !/^\d*$/.test(raw)) {
          // Invalid character for integer, ignore change
          return
        }
      }

      // Empty -> clear and propagate undefined
      if (raw === '') {
        setDraft('')
        onChange?.(undefined)
        return
      }

      if (decimal) {
        // For decimal inputs, keep intermediate states like "0." / "1."
        setDraft(raw)

        // Do not propagate while user is still typing the decimal point
        if (raw === '.' || raw.endsWith('.')) {
          return
        }

        const num = parseFloat(raw)
        if (!Number.isNaN(num)) {
          onChange?.(num)
        }
      } else {
        // Integer mode
        setDraft(raw)
        const num = parseInt(raw, 10)
        if (!Number.isNaN(num)) {
          onChange?.(num)
        }
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (['e', 'E', '+', '-'].includes(e.key)) {
        e.preventDefault()
        return
      }
      if (e.key === 'Enter') {
        // Prevent form submission and force blur so any onBlur handlers commit the value.
        e.preventDefault()
        e.currentTarget.blur()
        return
      }
    }

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.select()
    }

    const input = (
      <input
        ref={ref}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        id={id}
        placeholder={placeholder}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          prefix && 'pl-8',
          className
        )}
      />
    )

    if (prefix) {
      return (
        <div className="relative flex w-full">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
          {input}
        </div>
      )
    }

    return input
  }
)
NumberInput.displayName = 'NumberInput'
