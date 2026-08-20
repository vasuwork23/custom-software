'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  ClipboardPaste,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/NumberInput'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { QuickAddCompanyDialog, CompanySelect, type CompanyOption } from '@/components/sale-bills/selects'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Confidence = 'exact' | 'high' | 'medium' | 'low'

interface DraftReceipt {
  key: string
  sourceLine: string
  paymentDate: string
  companyRaw: string
  companyId: string | null
  companyName: string | null
  companyOutstanding: number | null
  companyConfidence: Confidence | null
  amount: number
  paymentMode: 'cash' | 'online'
  bankAccountRaw: string | null
  bankAccountId: string | null
  bankAccountName: string | null
  bankConfidence: Confidence | null
  remark: string
  warnings: string[]
  include?: boolean
}

interface BankAccountOption {
  _id: string
  accountName: string
  currentBalance: number
}

interface BatchResult {
  index: number
  success: boolean
  receiptId?: string
  companyName?: string
  amount?: number
  message?: string
}

const PLACEHOLDER = `Company name@50000
note about this payment
Another company@12000`

const SAMPLE = `ASTHA ENTERPRISE@50000
part payment received
ANKIT EGG BEATER@12000

bankbook
VASU
AKASHBHAI NAKRANI@25000
cheque cleared`

const FORMAT_HINTS: [string, string][] = [
  ['company@amount', 'one voucher'],
  ['a plain line after it', 'note for that voucher'],
  ['cash', 'following vouchers are cash'],
  ['bankbook  +  account name', 'following vouchers are online'],
]

function ConfidenceBadge({ confidence }: { confidence: Confidence | null }) {
  if (!confidence) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">
        no match
      </span>
    )
  }
  const styles: Record<Confidence, string> = {
    exact: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
    high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
    low: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400',
  }
  const labels: Record<Confidence, string> = {
    exact: 'learned',
    high: 'confident',
    medium: 'check',
    low: 'confirm',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', styles[confidence])}>
      {labels[confidence]}
    </span>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  )
}

export default function QuickVoucherPage() {
  const router = useRouter()
  const [rawText, setRawText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<DraftReceipt[]>([])
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [results, setResults] = useState<BatchResult[] | null>(null)
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([])
  const [addCompanyFor, setAddCompanyFor] = useState<{ key: string; name: string } | null>(null)

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: CompanyOption[] }>('/api/companies?limit=500')
    if (res.success) setCompanyOptions(res.data.companies)
  }, [])

  const fetchBankAccounts = useCallback(async () => {
    const res = await apiGet<{ accounts: BankAccountOption[] }>('/api/banks')
    if (res.success) {
      setBankAccounts(
        res.data.accounts.filter((a: BankAccountOption & { type?: string }) => a.type === 'online')
      )
    }
  }, [])

  useEffect(() => {
    fetchCompanies()
    fetchBankAccounts()
  }, [fetchCompanies, fetchBankAccounts])

  async function handleParse() {
    if (!rawText.trim()) return
    setParsing(true)
    setResults(null)
    const res = await apiPost<{ receipts: DraftReceipt[]; unparsed: string[] }>(
      '/api/received-voucher/parse',
      { text: rawText }
    )
    setParsing(false)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    if (!res.data.receipts.length) {
      toast.error('Could not find any "company@amount" lines in that message')
      setUnparsed(res.data.unparsed)
      return
    }
    setDrafts(res.data.receipts.map((r) => ({ ...r, include: true })))
    setUnparsed(res.data.unparsed)
    toast.success(`Found ${res.data.receipts.length} voucher${res.data.receipts.length === 1 ? '' : 's'}`)
  }

  const updateDraft = useCallback((key: string, patch: Partial<DraftReceipt>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }, [])

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  const readiness = useMemo(
    () =>
      drafts.map((d) => {
        const blockers: string[] = []
        if (!d.companyId) blockers.push('Pick a company')
        if (d.paymentMode === 'online' && !d.bankAccountId) blockers.push('Pick a bank account')
        if (!d.paymentDate) blockers.push('Pick a date')
        if (!Number.isFinite(d.amount) || d.amount === 0) blockers.push('Amount must not be zero')
        return { key: d.key, ready: blockers.length === 0, blockers }
      }),
    [drafts]
  )
  const readyByKey = useMemo(() => new Map(readiness.map((r) => [r.key, r])), [readiness])

  const includedReady = drafts.filter((d) => d.include && readyByKey.get(d.key)?.ready)
  const grandTotal = includedReady.reduce((s, d) => s + d.amount, 0)

  async function handleCreate() {
    if (!includedReady.length) return
    setSaving(true)

    const payload = includedReady.map((d) => ({
      companyId: d.companyId,
      amount: d.amount,
      paymentMode: d.paymentMode,
      bankAccountId: d.paymentMode === 'online' ? d.bankAccountId : undefined,
      paymentDate: d.paymentDate,
      remark: d.remark || undefined,
    }))

    // Teach the matcher every mapping confirmed on screen — shared with sale bills.
    const aliases: { raw: string; targetType: 'company' | 'bank'; targetId: string }[] = []
    for (const d of includedReady) {
      if (d.companyRaw && d.companyId) {
        aliases.push({ raw: d.companyRaw, targetType: 'company', targetId: d.companyId })
      }
      if (d.paymentMode === 'online' && d.bankAccountRaw && d.bankAccountId) {
        aliases.push({ raw: d.bankAccountRaw, targetType: 'bank', targetId: d.bankAccountId })
      }
    }

    const res = await apiPost<{ results: BatchResult[]; createdCount: number; failedCount: number }>(
      '/api/received-voucher/batch',
      { receipts: payload, aliases }
    )
    setSaving(false)

    if (!res.success) {
      toast.error(res.message)
      return
    }

    const { createdCount, failedCount } = res.data
    setResults(res.data.results)
    if (failedCount === 0) {
      toast.success(`Created ${createdCount} voucher${createdCount === 1 ? '' : 's'}`)
      setDrafts([])
    } else {
      toast.warning(`Created ${createdCount}, ${failedCount} failed — see details below`)
      const failedIndexes = new Set(res.data.results.filter((r) => !r.success).map((r) => r.index))
      setDrafts(includedReady.filter((_, i) => failedIndexes.has(i)).map((d) => ({ ...d })))
    }
  }

  function reset() {
    setDrafts([])
    setUnparsed([])
    setResults(null)
    setRawText('')
  }

  const showPasteBox = drafts.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quick Voucher from Message"
        breadcrumb={
          <>
            <Link href="/received-voucher" className="text-muted-foreground hover:text-foreground">
              Receive Voucher
            </Link>
            <span className="text-muted-foreground"> / Quick Voucher</span>
          </>
        }
      />

      {addCompanyFor && (
        <QuickAddCompanyDialog
          initialName={addCompanyFor.name}
          onCreated={(company) => {
            setCompanyOptions((prev) => [...prev, company])
            updateDraft(addCompanyFor.key, {
              companyId: company._id,
              companyName: company.companyName,
              companyConfidence: 'exact',
              warnings: [],
            })
            setAddCompanyFor(null)
          }}
          onClose={() => setAddCompanyFor(null)}
        />
      )}

      {results && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <h3 className="font-semibold text-sm">Result</h3>
          {results.map((r) => (
            <div key={r.index} className="flex items-center gap-2 text-sm">
              {r.success ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>
                    {r.companyName} — ₹{(r.amount ?? 0).toLocaleString('en-IN')} recorded
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">
                    Voucher {r.index + 1} failed: {r.message}
                  </span>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={reset}>
              Paste another message
            </Button>
            <Button size="sm" onClick={() => router.push('/received-voucher')}>
              Go to Receive Voucher
            </Button>
          </div>
        </div>
      )}

      {showPasteBox && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Paste your payment messages</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              One voucher per line. Each becomes a draft you review before anything is saved.
              Company names are matched against your records, and every correction you make is
              remembered — including corrections made on the sale-bill screen.
            </p>
            <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
              {FORMAT_HINTS.map(([shape, meaning]) => (
                <div key={shape} className="flex items-baseline gap-1.5 text-xs">
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">
                    {shape}
                  </code>
                  <span className="text-muted-foreground">→ {meaning}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Payments default to cash. A negative amount (
              <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px]">
                company@-5000
              </code>
              ) records money paid out instead.
            </p>
          </div>

          <textarea
            className="flex min-h-[240px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={PLACEHOLDER}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleParse} disabled={parsing || !rawText.trim()}>
              {parsing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reading...
                </>
              ) : (
                <>
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Read Messages
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => setRawText(SAMPLE)} disabled={parsing}>
              Try sample
            </Button>
            <Button variant="outline" asChild>
              <Link href="/received-voucher">Cancel</Link>
            </Button>
          </div>

          {unparsed.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-400">
                Skipped {unparsed.length} line{unparsed.length === 1 ? '' : 's'} with no
                &ldquo;@amount&rdquo;:
              </p>
              <pre className="mt-1 whitespace-pre-wrap text-[11px] text-amber-700 dark:text-amber-500">
                {unparsed.join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={reset}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to paste
              </Button>
              <span className="text-sm text-muted-foreground">
                {includedReady.length} of {drafts.length} ready
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total</div>
                <AmountDisplay amount={Math.round(grandTotal * 100) / 100} />
              </div>
              <Button onClick={handleCreate} disabled={saving || !includedReady.length}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  `Create ${includedReady.length} Voucher${includedReady.length === 1 ? '' : 's'}`
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="h-10 w-10 px-2" />
                  <th className="h-10 px-3 text-left font-medium min-w-[240px]">Company</th>
                  <th className="h-10 px-3 text-right font-medium w-32">Amount</th>
                  <th className="h-10 px-3 text-left font-medium w-44">Mode</th>
                  <th className="h-10 px-3 text-left font-medium w-36">Date</th>
                  <th className="h-10 px-3 text-left font-medium min-w-[160px]">Note</th>
                  <th className="h-10 w-10 px-2" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const r = readyByKey.get(draft.key)
                  return (
                    <tr
                      key={draft.key}
                      className={cn('border-b align-top last:border-0', !draft.include && 'opacity-50')}
                    >
                      <td className="p-2 pt-4">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={draft.include ?? true}
                          onChange={(e) => updateDraft(draft.key, { include: e.target.checked })}
                          aria-label="Include this voucher"
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <ConfidenceBadge confidence={draft.companyConfidence} />
                          <span className="text-[11px] text-muted-foreground truncate">
                            from &ldquo;{draft.companyRaw}&rdquo;
                          </span>
                        </div>
                        <CompanySelect
                          options={companyOptions}
                          value={draft.companyId ?? ''}
                          onValueChange={(v) =>
                            updateDraft(draft.key, {
                              companyId: v,
                              companyConfidence: 'exact',
                              warnings: [],
                            })
                          }
                          onRequestAdd={(name) =>
                            setAddCompanyFor({ key: draft.key, name: name || draft.companyRaw })
                          }
                        />
                        {draft.companyOutstanding != null &&
                          Math.abs(draft.companyOutstanding) >= 1 && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {draft.companyOutstanding > 0 ? 'Owes' : 'In advance'}: ₹
                              {Math.abs(Math.round(draft.companyOutstanding)).toLocaleString('en-IN')}
                            </p>
                          )}
                        <WarningList warnings={draft.warnings} />
                        {draft.include && r && !r.ready && <WarningList warnings={r.blockers} />}
                      </td>
                      <td className="p-2 pt-3">
                        <NumberInput
                          prefix="₹"
                          value={draft.amount}
                          onChange={(v) => updateDraft(draft.key, { amount: v ?? 0 })}
                          decimal
                          allowNegative
                          className="w-32 text-right"
                        />
                      </td>
                      <td className="p-2 pt-3 space-y-1">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.paymentMode}
                          onChange={(e) =>
                            updateDraft(draft.key, {
                              paymentMode: e.target.value as 'cash' | 'online',
                            })
                          }
                        >
                          <option value="cash">💵 Cash</option>
                          <option value="online">🏦 Online</option>
                        </select>
                        {draft.paymentMode === 'online' && (
                          <select
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={draft.bankAccountId ?? ''}
                            onChange={(e) =>
                              updateDraft(draft.key, {
                                bankAccountId: e.target.value,
                                bankConfidence: 'exact',
                              })
                            }
                          >
                            <option value="">Select bank account</option>
                            {bankAccounts.map((b) => (
                              <option key={b._id} value={b._id}>
                                {b.accountName}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="p-2 pt-3">
                        <Input
                          type="date"
                          value={draft.paymentDate}
                          onChange={(e) => updateDraft(draft.key, { paymentDate: e.target.value })}
                        />
                      </td>
                      <td className="p-2 pt-3">
                        <Input
                          value={draft.remark}
                          onChange={(e) => updateDraft(draft.key, { remark: e.target.value })}
                          placeholder="Optional note"
                        />
                      </td>
                      <td className="p-2 pt-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDraft(draft.key)}
                          aria-label="Remove voucher"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
