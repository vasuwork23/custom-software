'use client'

import { useState, useEffect } from 'react'
import { Check, ChevronsUpDown, Building2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface CompanyOption {
  _id: string
  companyName: string
}

export interface ProductOption {
  value: string        // "china:<id>" | "india:<id>"
  label: string        // display name with flag
  availableCtn: number
  availablePcs: number
  qtyPerCtn: number
}

export type ProductSelectCallback = (
  value: string,
  label: string,
  qtyPerCtn: number,
  availableCtn: number
) => void

// ─── Quick-Add Company Dialog ─────────────────────────────────────────────────

export function QuickAddCompanyDialog({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string
  onCreated: (company: { _id: string; companyName: string }) => void
  onClose: () => void
}) {
  const [companyName, setCompanyName] = useState(initialName)
  const [mobile, setMobile] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!companyName.trim()) return
    setLoading(true)
    const res = await apiPost<{ _id: string; companyName: string }>('/api/companies', {
      companyName: companyName.trim(),
      primaryMobile: mobile.trim() || undefined,
    })
    setLoading(false)
    if (!res.success) {
      toast.error(res.message ?? 'Failed to create company')
      return
    }
    toast.success(`Company "${res.data.companyName}" created`)
    onCreated(res.data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl space-y-4">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-base">Add New Company</h3>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Company Name *</Label>
            <Input
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Raj Traders"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mobile (optional)</Label>
            <Input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="e.g. 9876543210"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleCreate} disabled={loading || !companyName.trim()}>
            {loading ? 'Creating...' : 'Create Company'}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}


// ─── Company Searchable Select (with "Add Company" fallback) ──────────────────

export function CompanySelect({
  options,
  value,
  onValueChange,
  onRequestAdd,
}: {
  options: CompanyOption[]
  value: string
  onValueChange: (v: string) => void
  onRequestAdd: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const cashbookOpt = { _id: 'cashbook', companyName: '💵 Cashbook — Local buyer, direct cash payment' }
  const bankOpt = { _id: 'bankaccount', companyName: '🏦 Bank Account — Direct bank payment' }
  const allOptions = [cashbookOpt, bankOpt, ...options]

  const filtered = search.trim()
    ? allOptions.filter((c) =>
        c.companyName.toLowerCase().includes(search.toLowerCase())
      )
    : allOptions

  const selected = allOptions.find((c) => c._id === value)
  const showAddOption = search.trim().length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected?.companyName ?? 'Select company, Cashbook, or Bank'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search companies..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 && !showAddOption && (
              <CommandEmpty>No company found.</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c._id}
                  value={c._id}
                  onSelect={() => {
                    onValueChange(c._id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === c._id ? 'opacity-100' : 'opacity-0')}
                  />
                  {c.companyName}
                </CommandItem>
              ))}
              {showAddOption && (
                <CommandItem
                  key="__add_company__"
                  value="__add_company__"
                  onSelect={() => {
                    setOpen(false)
                    onRequestAdd(search.trim())
                    setSearch('')
                  }}
                  className="text-primary font-medium border-t mt-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add &quot;{search.trim()}&quot; as new company
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}


// ─── Product Searchable Select (server-side search, no N+1 calls) ────────────

export function ProductSelect({
  value,
  selectedLabel,
  onValueChange,
}: {
  value: string
  selectedLabel: string
  onValueChange: ProductSelectCallback
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const delay = search.trim() ? 300 : 0
    const timer = setTimeout(async () => {
      setLoading(true)
      const url = search.trim()
        ? `/api/sell-bills/product-options?search=${encodeURIComponent(search.trim())}`
        : '/api/sell-bills/product-options'
      const res = await apiGet<{ products: ProductOption[] }>(url)
      if (res.success) setOptions(res.data.products)
      setLoading(false)
    }, delay)
    return () => clearTimeout(timer)
  }, [open, search])

  function handleOpenChange(o: boolean) {
    setOpen(o)
    if (o) setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-w-[200px]"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? (selectedLabel || value) : 'Select product'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
        align="start"
        style={{ maxHeight: '320px', overflowY: 'auto' }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to search products..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList style={{ maxHeight: '260px' }}>
            {loading && (
              <div className="py-3 text-center text-sm text-muted-foreground">Loading...</div>
            )}
            {!loading && options.length === 0 && (
              <CommandEmpty>No available products found.</CommandEmpty>
            )}
            {!loading && options.length > 0 && (
              <CommandGroup>
                {options.map((opt) => {
                  const isSelected = value === opt.value
                  return (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => {
                        onValueChange(opt.value, opt.label, opt.qtyPerCtn, opt.availableCtn)
                        setOpen(false)
                        setSearch('')
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                        <span className="truncate">{opt.label}</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {opt.availableCtn} CTN · {opt.availablePcs.toLocaleString('en-IN')} PCS
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

