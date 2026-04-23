'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Banknote, Plus, Pencil, Trash2, ArrowLeftRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Label } from '@/components/ui/label'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'
import { format } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

interface BankAccountRow {
  _id: string
  accountName: string
  type: 'cash' | 'online'
  isDefault: boolean
  currentBalance: number
  transactionCount: number
}

interface InvestmentRow {
  _id: string
  investorName: string
  currentBalance: number
}

interface InvestmentTransactionRow {
  _id: string
  type: 'add' | 'withdraw'
  amount: number
  balanceAfter: number
  transactionDate: string
  note: string
}

export default function BanksPage() {
  const [accounts, setAccounts] = useState<BankAccountRow[]>([])
  const [investments, setInvestments] = useState<InvestmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccountRow | null>(null)
  const [accountName, setAccountName] = useState('')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [transferAmount, setTransferAmount] = useState<number | undefined>(undefined)
  const [transferDate, setTransferDate] = useState<Date>(new Date())
  const [transferNotes, setTransferNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addCashOpen, setAddCashOpen] = useState(false)
  const [addCashAmount, setAddCashAmount] = useState('')
  const [addCashDate, setAddCashDate] = useState<Date>(new Date())
  const [addCashNote, setAddCashNote] = useState('')
  const [withdrawCashOpen, setWithdrawCashOpen] = useState(false)
  const [withdrawCashAmount, setWithdrawCashAmount] = useState('')
  const [withdrawCashDate, setWithdrawCashDate] = useState<Date>(new Date())
  const [withdrawCashNote, setWithdrawCashNote] = useState('')
  const [addBankOpen, setAddBankOpen] = useState(false)
  const [selectedBank, setSelectedBank] = useState<BankAccountRow | null>(null)
  const [addBankAmount, setAddBankAmount] = useState('')
  const [addBankDate, setAddBankDate] = useState<Date>(new Date())
  const [addBankNote, setAddBankNote] = useState('')
  const [addBankSubmitting, setAddBankSubmitting] = useState(false)
  const [investmentDialogOpen, setInvestmentDialogOpen] = useState(false)
  const [investorName, setInvestorName] = useState('')
  const [investmentSubmitting, setInvestmentSubmitting] = useState(false)
  const [investmentTxDialogOpen, setInvestmentTxDialogOpen] = useState(false)
  const [selectedInvestment, setSelectedInvestment] = useState<InvestmentRow | null>(null)
  const [investmentTxType, setInvestmentTxType] = useState<'add' | 'withdraw'>('add')
  const [investmentTxAmount, setInvestmentTxAmount] = useState('')
  const [investmentTxDate, setInvestmentTxDate] = useState<Date>(new Date())
  const [investmentTxNote, setInvestmentTxNote] = useState('')
  const [investmentTxSubmitting, setInvestmentTxSubmitting] = useState(false)
  const [investmentEditOpen, setInvestmentEditOpen] = useState(false)
  const [editingInvestment, setEditingInvestment] = useState<InvestmentRow | null>(null)
  const [editingInvestorName, setEditingInvestorName] = useState('')
  const [investmentEditSubmitting, setInvestmentEditSubmitting] = useState(false)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    const result = await apiGet<{ accounts: BankAccountRow[] }>('/api/banks')
    setLoading(false)
    if (result.success) setAccounts(result.data.accounts)
    else toast.error(result.message)
  }, [])

  const fetchInvestments = useCallback(async () => {
    const result = await apiGet<{ investments: InvestmentRow[] }>('/api/banks/investments')
    if (result.success) setInvestments(result.data.investments)
    else toast.error(result.message)
  }, [])

  useEffect(() => {
    fetchAccounts()
    fetchInvestments()
  }, [fetchAccounts, fetchInvestments])

  const cashAccount = accounts.find((a) => a.type === 'cash')
  const onlineAccounts = accounts.filter((a) => a.type === 'online')

  const cashBalance = cashAccount?.currentBalance ?? 0
  const bankBalance = onlineAccounts.reduce(
    (sum, acc) => sum + (acc.currentBalance ?? 0),
    0
  )
  const totalBalance = cashBalance + bankBalance
  // Transfer options: expose Cash explicitly and all online bank accounts.
  const accountOptions: SearchableSelectOption<string>[] = [
    {
      value: cashAccount ? String(cashAccount._id) : 'cash',
      label: `💵 Cash — ₹${cashBalance.toLocaleString('en-IN')}`,
    },
    ...onlineAccounts.map((a) => ({
      value: String(a._id),
      label: `🏦 ${a.accountName} — ₹${(a.currentBalance ?? 0).toLocaleString('en-IN')}`,
    })),
  ]

  const toAccountOptions = accountOptions.filter((o) => o.value !== fromAccountId)

  function openAddAccount() {
    setEditingAccount(null)
    setAccountName('')
    setAccountDialogOpen(true)
  }

  function openEditAccount(account: BankAccountRow) {
    setEditingAccount(account)
    setAccountName(account.accountName)
    setAccountDialogOpen(true)
  }

  async function handleSaveAccount() {
    const name = accountName.trim()
    if (!name) {
      toast.error('Account name is required')
      return
    }
    setSubmitting(true)
    if (editingAccount) {
      const result = await apiPut(`/api/banks/${editingAccount._id}`, { accountName: name })
      if (result.success) {
        toast.success('Account updated')
        setAccountDialogOpen(false)
        fetchAccounts()
      } else toast.error(result.message)
    } else {
      const result = await apiPost('/api/banks', { accountName: name })
      if (result.success) {
        toast.success('Account created')
        setAccountDialogOpen(false)
        fetchAccounts()
      } else toast.error(result.message)
    }
    setSubmitting(false)
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault()
    const amount = transferAmount ?? 0
    if (!fromAccountId || !toAccountId || !(amount > 0)) {
      toast.error('Select both accounts and enter a valid amount')
      return
    }
    setSubmitting(true)
    const result = await apiPost('/api/banks/transfer', {
      fromAccountId,
      toAccountId,
      amount,
      date: format(transferDate, 'yyyy-MM-dd'),
      notes: transferNotes.trim() || undefined,
    })
    setSubmitting(false)
    if (result.success) {
      toast.success('Transfer completed')
      setTransferDialogOpen(false)
      setFromAccountId('')
      setToAccountId('')
      setTransferAmount(undefined)
      setTransferDate(new Date())
      setTransferNotes('')
      fetchAccounts()
    } else toast.error(result.message)
  }

  async function handleDeleteAccount(account: BankAccountRow) {
    const balance = account.currentBalance ?? 0
    if (balance !== 0) {
      toast.error(
        `Cannot delete "${account.accountName}" — balance is ₹${balance.toLocaleString(
          'en-IN'
        )}. Please clear balance to ₹0 first.`
      )
      return
    }
    const result = await apiDelete(`/api/banks/${account._id}`)
    if (result.success) {
      toast.success('Account deleted')
      fetchAccounts()
    } else toast.error(result.message)
  }

  async function handleAddCash() {
    const amount = Number(addCashAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!addCashNote.trim()) {
      toast.error('Note is required')
      return
    }
    setSubmitting(true)
    const result = await apiPost('/api/our-banks/cash/add', {
      amount,
      date: format(addCashDate, 'yyyy-MM-dd'),
      note: addCashNote.trim() || undefined,
    })
    setSubmitting(false)
    if (result.success) {
      toast.success('Cash added')
      setAddCashOpen(false)
      setAddCashAmount('')
      setAddCashNote('')
      setAddCashDate(new Date())
      fetchAccounts()
    } else {
      toast.error(result.message)
    }
  }

  async function handleWithdrawCash() {
    const amount = Number(withdrawCashAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!withdrawCashNote.trim()) {
      toast.error('Note is required')
      return
    }
    if (amount > cashBalance) {
      toast.error(`Insufficient cash balance. Available: ₹${cashBalance.toLocaleString('en-IN')}`)
      return
    }

    setSubmitting(true)
    const result = await apiPost('/api/our-banks/cash/withdraw', {
      amount,
      date: format(withdrawCashDate, 'yyyy-MM-dd'),
      note: withdrawCashNote.trim() || undefined,
    })
    setSubmitting(false)

    if (result.success) {
      toast.success('Cash withdrawn')
      setWithdrawCashOpen(false)
      setWithdrawCashAmount('')
      setWithdrawCashDate(new Date())
      setWithdrawCashNote('')
      fetchAccounts()
    } else {
      toast.error(result.message)
    }
  }

  async function handleAddBankAmount() {
    const amount = Number(addBankAmount)
    if (!selectedBank) {
      toast.error('Select a bank account')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!addBankNote.trim()) {
      toast.error('Note is required')
      return
    }
    setAddBankSubmitting(true)
    const result = await apiPost(`/api/banks/${selectedBank._id}/add-amount`, {
      amount,
      date: format(addBankDate, 'yyyy-MM-dd'),
      note: addBankNote.trim() || undefined,
    })
    setAddBankSubmitting(false)
    if (result.success) {
      toast.success(
        `₹${amount.toLocaleString('en-IN')} added to ${selectedBank.accountName}`
      )
      setAddBankOpen(false)
      setSelectedBank(null)
      setAddBankAmount('')
      setAddBankNote('')
      setAddBankDate(new Date())
      fetchAccounts()
    } else {
      toast.error(result.message)
    }
  }

  async function handleAddInvestment() {
    const name = investorName.trim()

    if (!name) {
      toast.error('Investor name is required')
      return
    }

    setInvestmentSubmitting(true)
    const result = await apiPost('/api/banks/investments', {
      investorName: name,
    })
    setInvestmentSubmitting(false)

    if (result.success) {
      toast.success('Investor added')
      setInvestmentDialogOpen(false)
      setInvestorName('')
      fetchInvestments()
    } else {
      toast.error(result.message)
    }
  }

  function openInvestmentTransactionDialog(investment: InvestmentRow, type: 'add' | 'withdraw') {
    setSelectedInvestment(investment)
    setInvestmentTxType(type)
    setInvestmentTxAmount('')
    setInvestmentTxDate(new Date())
    setInvestmentTxNote('')
    setInvestmentTxDialogOpen(true)
  }

  async function handleInvestmentTransaction() {
    if (!selectedInvestment) {
      toast.error('Investor not selected')
      return
    }
    const amount = Number(investmentTxAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (investmentTxType === 'withdraw' && amount > selectedInvestment.currentBalance) {
      toast.error(
        `Withdraw amount exceeds balance. Available: ₹${selectedInvestment.currentBalance.toLocaleString('en-IN')}`
      )
      return
    }

    setInvestmentTxSubmitting(true)
    const result = await apiPost(`/api/banks/investments/${selectedInvestment._id}/transactions`, {
      type: investmentTxType,
      amount,
      date: format(investmentTxDate, 'yyyy-MM-dd'),
      note: investmentTxNote.trim() || undefined,
    })
    setInvestmentTxSubmitting(false)

    if (result.success) {
      toast.success(
        investmentTxType === 'add'
          ? 'Investment amount added'
          : 'Investment amount withdrawn'
      )
      setInvestmentTxDialogOpen(false)
      setSelectedInvestment(null)
      fetchAccounts()
      fetchInvestments()
    } else {
      toast.error(result.message)
    }
  }

  function openEditInvestment(investment: InvestmentRow) {
    setEditingInvestment(investment)
    setEditingInvestorName(investment.investorName)
    setInvestmentEditOpen(true)
  }

  async function handleSaveInvestmentEdit() {
    if (!editingInvestment) return
    const name = editingInvestorName.trim()
    if (!name) {
      toast.error('Investor name is required')
      return
    }
    setInvestmentEditSubmitting(true)
    const result = await apiPut(`/api/banks/investments/${editingInvestment._id}`, {
      investorName: name,
    })
    setInvestmentEditSubmitting(false)
    if (result.success) {
      toast.success('Investor updated')
      setInvestmentEditOpen(false)
      setEditingInvestment(null)
      setEditingInvestorName('')
      fetchInvestments()
    } else {
      toast.error(result.message)
    }
  }

  async function handleDeleteInvestment(investment: InvestmentRow) {
    if ((investment.currentBalance ?? 0) !== 0) {
      toast.error(
        `Cannot delete "${investment.investorName}" — balance is ₹${investment.currentBalance.toLocaleString('en-IN')}. Please clear balance to ₹0 first.`
      )
      return
    }
    const result = await apiDelete(`/api/banks/investments/${investment._id}`)
    if (result.success) {
      toast.success('Investor deleted')
      fetchInvestments()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Our Banks"
        description="Manage bank accounts, cash, and transfers."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTransferDialogOpen(true)}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Transfer
            </Button>
            <Button variant="outline" onClick={() => setInvestmentDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Investment
            </Button>
            <Button onClick={openAddAccount}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Account
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36 rounded-lg" />
            <Skeleton className="h-36 rounded-lg" />
            <Skeleton className="h-36 rounded-lg" />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-6 md:flex-row">
            <div className="flex-1 rounded-lg border bg-black text-white p-4">
              <p className="text-xs text-gray-400">Total Balance (All Accounts)</p>
              <p className="text-2xl font-bold mt-1">
                ₹{totalBalance.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Cash + {onlineAccounts.length} bank account
                {onlineAccounts.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex-1 rounded-lg border bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">💵 Cash</p>
                  <p className="text-xl font-bold mt-1">
                    ₹{cashBalance.toLocaleString('en-IN')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddCashOpen(true)}
                >
                  + Add Cash
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWithdrawCashOpen(true)}
                >
                  - Withdraw Cash
                </Button>
              </div>
            </div>

            <div className="flex-1 rounded-lg border bg-white p-4">
              <p className="text-xs text-gray-500">🏦 Bank Accounts</p>
              <p className="text-xl font-bold mt-1">
                ₹{bankBalance.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {onlineAccounts.length} account
                {onlineAccounts.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {cashAccount && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Cash
              </h2>
              <Link href="/our-banks/cash">
                <Card
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-muted/50',
                    cashAccount.currentBalance < 0 &&
                      'border-destructive/50 bg-destructive/5'
                  )}
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <span className="text-lg font-semibold flex items-center gap-2">
                      <Banknote className="h-5 w-5" />
                      CASH
                    </span>
                    {cashAccount.currentBalance < 0 && (
                      <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded">
                        Negative balance
                      </span>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      <AmountDisplay amount={cashAccount.currentBalance} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {cashAccount.transactionCount} transaction
                      {cashAccount.transactionCount !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Click to view history
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </section>
          )}

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Bank Accounts</h2>
        {onlineAccounts.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No bank accounts yet"
            description="Add an online bank account to track payments and transfers."
          >
            <Button onClick={openAddAccount}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Account
            </Button>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {onlineAccounts.map((acc) => (
              <Card key={acc._id} className="overflow-hidden">
                <Link href={`/banks/${acc._id}`} className="block">
                  <CardHeader className="pb-2">
                    <span className="font-semibold">{acc.accountName}</span>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="text-xl font-semibold">
                      <AmountDisplay amount={acc.currentBalance} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {acc.transactionCount} transaction{acc.transactionCount !== 1 ? 's' : ''}
                    </p>
                  </CardContent>
                </Link>
                <div className="flex flex-wrap gap-2 px-6 pb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      setSelectedBank(acc)
                      setAddBankOpen(true)
                    }}
                  >
                    + Add Amount
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <Link href={`/banks/${acc._id}`}>History</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      openEditAccount(acc)
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <ConfirmDialog
                    title="Delete account"
                    description="This will delete the bank account and all its transaction history. Balance must be ₹0."
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={() => handleDeleteAccount(acc)}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        title={
                          acc.currentBalance !== 0
                            ? 'Balance must be zero to delete'
                            : 'Delete bank'
                        }
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    }
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Investors</h2>
        {investments.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No investors yet"
            description="Add an investor to track investment balance and cashbook movement."
          >
            <Button variant="outline" onClick={() => setInvestmentDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Investment
            </Button>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {investments.map((inv) => (
              <Card key={inv._id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <span className="font-semibold">{inv.investorName}</span>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-xl font-semibold">
                    <AmountDisplay amount={inv.currentBalance} />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Current investment balance</p>
                </CardContent>
                <div className="flex flex-wrap gap-2 px-6 pb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openInvestmentTransactionDialog(inv, 'add')}
                  >
                    + Add Amount
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openInvestmentTransactionDialog(inv, 'withdraw')}
                  >
                    Withdraw
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <Link href={`/banks/investments/${inv._id}`}>History</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditInvestment(inv)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <ConfirmDialog
                    title="Delete investor"
                    description="This will delete the investor and all investment transactions. Balance must be ₹0."
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={() => handleDeleteInvestment(inv)}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        title={
                          inv.currentBalance !== 0
                            ? 'Balance must be zero to delete'
                            : 'Delete investor'
                        }
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    }
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
        </>
      )}

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Add Bank Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="accountName">Account Name</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. HDFC Current"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveAccount} disabled={submitting}>
                {submitting ? 'Saving...' : editingAccount ? 'Update' : 'Create'}
              </Button>
              <Button variant="outline" onClick={() => setAccountDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>From Account</Label>
              <SearchableSelect
                options={accountOptions}
                value={fromAccountId}
                onValueChange={(v) => {
                  setFromAccountId(v)
                  if (toAccountId === v) setToAccountId('')
                }}
                placeholder="Select account"
              />
            </div>
            <div className="space-y-2">
              <Label>To Account</Label>
              <SearchableSelect
                options={toAccountOptions}
                value={toAccountId}
                onValueChange={setToAccountId}
                placeholder="Select account"
                emptyText="Select From account first"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transferAmount">Amount (₹)</Label>
              <NumberInput
                id="transferAmount"
                placeholder="Enter amount"
                prefix="₹"
                value={transferAmount}
                onChange={setTransferAmount}
                min={0.01}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full justify-start text-left font-normal')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(transferDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={transferDate} onSelect={(d) => d && setTransferDate(d)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transferNotes">Notes (optional)</Label>
              <Input
                id="transferNotes"
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                placeholder="Optional note"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !fromAccountId || !toAccountId || !((transferAmount ?? 0) > 0)}>
                {submitting ? 'Transferring...' : 'Transfer'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setTransferDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={addCashOpen} onOpenChange={setAddCashOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Cash</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={addCashAmount}
                onChange={(e) => setAddCashAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(addCashDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={addCashDate}
                    onSelect={(d) => d && setAddCashDate(d)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>
                Note <span className="text-red-500">*</span>
              </Label>
              <Input
                value={addCashNote}
                onChange={(e) => setAddCashNote(e.target.value)}
                placeholder="Source of cash..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddCashOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleAddCash} disabled={submitting}>
              + Add Cash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={withdrawCashOpen} onOpenChange={setWithdrawCashOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw Cash</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={withdrawCashAmount}
                onChange={(e) => setWithdrawCashAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(withdrawCashDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={withdrawCashDate}
                    onSelect={(d) => d && setWithdrawCashDate(d)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>
                Note <span className="text-red-500">*</span>
              </Label>
              <Input
                value={withdrawCashNote}
                onChange={(e) => setWithdrawCashNote(e.target.value)}
                placeholder="Reason for withdrawal..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setWithdrawCashOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleWithdrawCash} disabled={submitting}>
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={addBankOpen} onOpenChange={setAddBankOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add Amount{selectedBank ? ` — ${selectedBank.accountName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={addBankAmount}
                onChange={(e) => setAddBankAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(addBankDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={addBankDate}
                    onSelect={(d) => d && setAddBankDate(d)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>
                Note <span className="text-red-500">*</span>
              </Label>
              <Input
                value={addBankNote}
                onChange={(e) => setAddBankNote(e.target.value)}
                placeholder="e.g. Opening balance, deposit..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddBankOpen(false)}
              disabled={addBankSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddBankAmount}
              disabled={addBankSubmitting}
            >
              {addBankSubmitting ? 'Adding...' : 'Add Amount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={investmentDialogOpen} onOpenChange={setInvestmentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Investment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Investor Name *</Label>
              <Input
                value={investorName}
                onChange={(e) => setInvestorName(e.target.value)}
                placeholder="e.g. Rahul Shah"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInvestmentDialogOpen(false)}
              disabled={investmentSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddInvestment}
              disabled={investmentSubmitting}
            >
              {investmentSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={investmentTxDialogOpen} onOpenChange={setInvestmentTxDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {investmentTxType === 'add' ? 'Add Amount' : 'Withdraw Amount'}
              {selectedInvestment ? ` — ${selectedInvestment.investorName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={investmentTxAmount}
                onChange={(e) => setInvestmentTxAmount(e.target.value)}
                placeholder={
                  investmentTxType === 'add'
                    ? 'Enter amount to add'
                    : 'Enter amount to withdraw'
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(investmentTxDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={investmentTxDate}
                    onSelect={(d) => d && setInvestmentTxDate(d)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>Note</Label>
              <Input
                value={investmentTxNote}
                onChange={(e) => setInvestmentTxNote(e.target.value)}
                placeholder="Optional note"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This also updates cashbook automatically.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInvestmentTxDialogOpen(false)}
              disabled={investmentTxSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleInvestmentTransaction}
              disabled={investmentTxSubmitting}
            >
              {investmentTxSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={investmentEditOpen} onOpenChange={setInvestmentEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Investor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Investor Name *</Label>
              <Input
                value={editingInvestorName}
                onChange={(e) => setEditingInvestorName(e.target.value)}
                placeholder="Investor name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInvestmentEditOpen(false)}
              disabled={investmentEditSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveInvestmentEdit}
              disabled={investmentEditSubmitting}
            >
              {investmentEditSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
