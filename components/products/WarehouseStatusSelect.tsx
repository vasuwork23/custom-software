'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const options = [
  { value: 'china_warehouse', label: 'China Warehouse' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'india_warehouse', label: 'India Warehouse' },
] as const

export type WarehouseStatus = (typeof options)[number]['value']

interface WarehouseStatusSelectProps {
  value: WarehouseStatus
  onValueChange: (value: WarehouseStatus) => void
  disabled?: boolean
  className?: string
}

export function WarehouseStatusSelect({
  value,
  onValueChange,
  disabled,
  className,
}: WarehouseStatusSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as WarehouseStatus)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
