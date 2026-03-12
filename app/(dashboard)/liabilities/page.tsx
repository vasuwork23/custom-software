'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'

type Source = 'cash' | 'bank'
type StatusFilter = 'all' | 'blocked' | 'unblocked'

interface Liability {
  _id: string
  amount: number
  reason: string
  source: Source
  bankAccountId?: string | null
  bankAccountName?: string
  status: 'blocked' | 'unblocked'
  blockedAt: string
  unblockedAt?: string | null
  unblockedReason?: string | null
}

interface Summary {
  totalBlocked: number
  totalUnblocked: number
  activeCount: number
}

interface BankAccountOption {
  _id: string
  accountName: string
  currentBalance: number
  type: 'cash' | 'online'
}

export default function LiabilitiesPage() {
  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showBlock, setShowBlock] = useState(false)
  const [showUnblock, setShowUnblock] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState<Source>('cash')
  const [bankAccountId, setBankAccountId] = useState<string>('')
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([])
  const [selectedLiability, setSelectedLiability] = useState<Liability | null>(null)
  const [unblockedReason, setUnblockedReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchLiabilities = useCallback(async () => {
    setLoading(true)
    const res = await apiGet<{ summary: Summary; liabilities: Liability[] }>('/api/liabilities')
    setLoading(false)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    setLiabilities(res.data.liabilities)
    setSummary(res.data.summary)
  }, [])

  const fetchBankAccounts = useCallback(async () => {
    const res = await apiGet<{ accounts: BankAccountOption[] }>('/api/banks')
    if (!res.success) {
      toast.error(res.message)
      return
    }
    setBankAccounts(res.data.accounts)
  }, [])

  useEffect(() => {
    fetchLiabilities()
    fetchBankAccounts()
  }, [fetchLiabilities, fetchBankAccounts])

  const filteredLiabilities = useMemo(
    () =>
      liabilities.filter((l) => {
        if (filter === 'all') return true
        return l.status === filter
      }),
    [liabilities, filter]
  )

  const openUnblockDialog = (l: Liability) => {
    setSelectedLiability(l)
    setUnblockedReason('')
    setShowUnblock(true)
  }

  const handleBlock = async () => {
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!reason.trim()) {
      toast.error('Reason is required')
      return
    }
    if (source === 'bank' && !bankAccountId) {
      toast.error('Select bank account')
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        amount: numericAmount,
        reason: reason.trim(),
        source,
      }
      if (source === 'bank') payload.bankAccountId = bankAccountId
      const res = await apiPost('/api/liabilities', payload)
      if (!res.success) {
        toast.error(res.message)
      } else {
        toast.success('Amount blocked')
        setShowBlock(false)
        setAmount('')
        setReason('')
        setSource('cash')
        setBankAccountId('')
        fetchLiabilities()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleUnblock = async () => {
    if (!selectedLiability) return
    setSubmitting(true)
    try {
      const res = await apiPut(`/api/liabilities/${selectedLiability._id}/unblock`, {
        unblockedReason,
      })
      if (!res.success) {
        toast.error(res.message)
      } else {
        toast.success('Amount unblocked')
        setShowUnblock(false)
        setSelectedLiability(null)
        setUnblockedReason('')
        fetchLiabilities()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/liabilities/${id}`)
    if (!res.success) {
      toast.error(res.message)
    } else {
      toast.success('Liability deleted')
      fetchLiabilities()
    }
  }

  const totalBlocked = summary?.totalBlocked ?? 0
  const totalUnblocked = summary?.totalUnblocked ?? 0
  const activeCount = summary?.activeCount ?? 0

  const cashAccount = bankAccounts.find((a) => a.type === 'cash')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liabilities"
        description="Blocked amounts excluded from available balance."
        action={
          <Button onClick={() => setShowBlock(true)}>+ Block Amount</Button>
        }
      />

      <div className="flex gap-3 mb-2">
        <Card className="flex-1">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Total Blocked</p>
            <p className="text-xl font-bold text-red-600">
              ₹{totalBlocked.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Active Liabilities</p>
            <p className="text-xl font-bold">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Total Unblocked</p>
            <p className="text-xl font-bold text-green-600">
              ₹{totalUnblocked.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
      </div>

      {cashAccount && totalBlocked > 0 && (
        <p className="text-xs text-muted-foreground">
          Note: Cash and bank balances already reflect blocked liabilities. Cash includes ₹
          {totalBlocked.toLocaleString('en-IN')} blocked in liabilities.
        </p>
      )}

      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filter === 'blocked' ? 'default' : 'outline'}
          onClick={() => setFilter('blocked')}
        >
          🔴 Blocked
        </Button>
        <Button
          size="sm"
          variant={filter === 'unblocked' ? 'default' : 'outline'}
          onClick={() => setFilter('unblocked')}
        >
          ✅ Unblocked
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left text-xs font-medium">Date</th>
              <th className="p-2 text-left text-xs font-medium">Reason</th>
              <th className="p-2 text-left text-xs font-medium">Source</th>
              <th className="p-2 text-right text-xs font-medium">Amount</th>
              <th className="p-2 text-left text-xs font-medium">Status</th>
              <th className="p-2 text-left text-xs font-medium">Unblocked At</th>
              <th className="p-2 text-left text-xs font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredLiabilities.map((l) => (
              <tr key={l._id} className="border-b">
                <td className="p-2 text-xs">
                  {l.blockedAt ? format(new Date(l.blockedAt), 'dd MMM yyyy') : '—'}
                </td>
                <td className="p-2 text-xs">{l.reason}</td>
                <td className="p-2 text-xs">
                  {l.source === 'cash'
                    ? '💵 Cash'
                    : `🏦 ${l.bankAccountName ?? 'Bank'}`}
                </td>
                <td className="p-2 text-right font-medium text-red-600">
                  ₹{l.amount.toLocaleString('en-IN')}
                </td>
                <td className="p-2 text-xs">
                  {l.status === 'blocked' ? (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      🔴 Blocked
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✅ Unblocked
                    </span>
                  )}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {l.unblockedAt ? (
                    <div>
                      <p>{format(new Date(l.unblockedAt), 'dd MMM yyyy')}</p>
                      {l.unblockedReason && (
                        <p className="text-[10px]">{l.unblockedReason}</p>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-2 text-xs">
                  <div className="flex gap-2">
                    {l.status === 'blocked' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openUnblockDialog(l)}
                      >
                        Unblock
                      </Button>
                    )}
                    {l.status === 'unblocked' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(l._id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filteredLiabilities.length && !loading && (
              <tr>
                <td
                  className="p-4 text-center text-xs text-muted-foreground"
                  colSpan={7}
                >
                  No liabilities found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Block Amount Dialog */}
      <Dialog open={showBlock} onOpenChange={setShowBlock}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block Amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Reserved for GST payment, Pending refund..."
              />
            </div>
            <div className="space-y-1">
              <Label>Deduct From *</Label>
              <Select
                value={source}
                onValueChange={(v: Source) => setSource(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">💵 Cash</SelectItem>
                  <SelectItem value="bank">🏦 Bank Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {source === 'bank' && (
              <div className="space-y-1">
                <Label>Bank Account *</Label>
                <Select
                  value={bankAccountId}
                  onValueChange={(v) => setBankAccountId(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select bank account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts
                      .filter((b) => b.type === 'online')
                      .map((b) => (
                        <SelectItem key={b._id} value={b._id}>
                          {b.accountName} — ₹
                          {b.currentBalance.toLocaleString('en-IN')}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowBlock(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleBlock} disabled={submitting}>
              {submitting ? 'Blocking…' : '🔒 Block Amount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unblock Dialog */}
      <Dialog open={showUnblock} onOpenChange={setShowUnblock}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unblock Amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              ₹
              {selectedLiability
                ? selectedLiability.amount.toLocaleString('en-IN')
                : 0}{' '}
              will be returned to{' '}
              {selectedLiability?.source === 'cash'
                ? 'Cash'
                : selectedLiability?.bankAccountName ?? 'Bank'}
              .
            </p>
            <div className="space-y-1">
              <Label>Reason for unblocking (optional)</Label>
              <Input
                value={unblockedReason}
                onChange={(e) => setUnblockedReason(e.target.value)}
                placeholder="e.g. GST paid, Refund cancelled..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowUnblock(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleUnblock} disabled={submitting}>
              {submitting ? 'Unblocking…' : '✅ Unblock Amount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

