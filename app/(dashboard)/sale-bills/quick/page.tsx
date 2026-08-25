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
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/NumberInput'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import {
  QuickAddCompanyDialog,
  CompanySelect,
  ProductSelect,
  type CompanyOption,
} from '@/components/sale-bills/selects'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ─── Types (mirror of /api/sell-bills/parse response) ────────────────────────

type Confidence = 'exact' | 'high' | 'medium' | 'low'

interface DraftItem {
  sourceLine: string
  productRaw: string
  qty: number
  unit: 'ctn' | 'pcs'
  productValue: string | null
  productLabel: string | null
  qtyPerCtn: number
  availableCtn: number
  availablePcs: number
  ctn: number
  pcs: number
  ratePerPcs: number | null
  confidence: Confidence | null
  alternatives: { value: string; label: string; score: number }[]
  warnings: string[]
}

interface DraftBill {
  key: string
  sourceText: string
  billDate: string
  companyRaw: string | null
  companyId: string | null
  companyName: string | null
  companyConfidence: Confidence | null
  companyAlternatives: { _id: string; companyName: string; score: number }[]
  assumedCashbook: boolean
  bankAccountRaw: string | null
  bankAccountName: string | null
  bankConfidence: Confidence | null
  notes: string
  items: DraftItem[]
  warnings: string[]
  include?: boolean
  bankAccountId?: string
}

interface BankAccountOption {
  _id: string
  accountName: string
  currentBalance: number
}

interface BatchResult {
  index: number
  success: boolean
  billId?: string
  billNumber?: number
  grandTotal?: number
  message?: string
}

// ─── Small presentational helpers ─────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

// Shown greyed inside the empty box — the shortest thing that conveys the shape.
const PLACEHOLDER = `Company name
3 ctn - laundry pods @12.5
2 ctn - garlic crusher @250`

// Loaded by "Try sample" — exercises all four company modes in one paste.
const SAMPLE = `[20/08/26, 11:51 AM] Sales: ASTHA ENTERPRISE
3 ctn - laundry pods @12.5
2 ctn - garlic crusher @250

Cashbook
1 ctn - apple basket @45

bankbook
VASU
5 ctn - car washer gun @180

2 ctn - h2o humidifier @80`

/** The four ways a message can say who the bill is for. */
const FORMAT_HINTS: [string, string][] = [
  ['Company name', 'bills that company'],
  ['Cashbook  /  cash', 'cash sale'],
  ['bankbook  +  account name', 'bank sale'],
  ['(nothing — straight to items)', 'Cashbook'],
]

export default function QuickBillPage() {
  const router = useRouter()
  const [rawText, setRawText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<DraftBill[]>([])
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [results, setResults] = useState<BatchResult[] | null>(null)
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([])
  const [addCompanyFor, setAddCompanyFor] = useState<{ key: string; name: string } | null>(null)

  const fetchCompanies = useCallback(async () => {
    const res = await apiGet<{ companies: CompanyOption[] }>('/api/companies?basic=true')
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

  // ── Parse ───────────────────────────────────────────────────────────────────

  async function handleParse() {
    if (!rawText.trim()) return
    setParsing(true)
    setResults(null)
    const res = await apiPost<{ bills: DraftBill[]; unparsed: string[] }>('/api/sell-bills/parse', {
      text: rawText,
    })
    setParsing(false)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    if (!res.data.bills.length) {
      toast.error('Could not find any bills in that message')
      setUnparsed(res.data.unparsed)
      return
    }
    setDrafts(res.data.bills.map((b) => ({ ...b, include: true })))
    setUnparsed(res.data.unparsed)
    toast.success(`Found ${res.data.bills.length} bill${res.data.bills.length === 1 ? '' : 's'}`)
  }

  // ── Draft mutation helpers ──────────────────────────────────────────────────

  const updateDraft = useCallback((key: string, patch: Partial<DraftBill>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }, [])

  const updateItem = useCallback((key: string, itemIndex: number, patch: Partial<DraftItem>) => {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key
          ? { ...d, items: d.items.map((it, i) => (i === itemIndex ? { ...it, ...patch } : it)) }
          : d
      )
    )
  }, [])

  function setItemProduct(
    key: string,
    itemIndex: number,
    value: string,
    label: string,
    qtyPerCtn: number,
    availableCtn: number
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d
        return {
          ...d,
          items: d.items.map((it, i) => {
            if (i !== itemIndex) return it
            // Keep whichever quantity the message actually stated, then re-derive the other.
            const ctn = it.unit === 'ctn' ? it.ctn : qtyPerCtn > 0 ? it.pcs / qtyPerCtn : 0
            const pcs = it.unit === 'ctn' ? Math.round(ctn * qtyPerCtn) : it.pcs
            return {
              ...it,
              productValue: value,
              productLabel: label,
              qtyPerCtn,
              availableCtn,
              availablePcs: Math.round(availableCtn * qtyPerCtn),
              ctn: parseFloat(ctn.toFixed(4)),
              pcs,
              confidence: 'high',
              warnings: [],
            }
          }),
        }
      })
    )
  }

  function setItemCtn(key: string, itemIndex: number, ctn: number) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key
          ? {
              ...d,
              items: d.items.map((it, i) =>
                i === itemIndex
                  ? { ...it, ctn, pcs: it.qtyPerCtn > 0 ? Math.round(ctn * it.qtyPerCtn) : it.pcs }
                  : it
              ),
            }
          : d
      )
    )
  }

  function setItemPcs(key: string, itemIndex: number, pcs: number) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key
          ? {
              ...d,
              items: d.items.map((it, i) =>
                i === itemIndex
                  ? {
                      ...it,
                      pcs,
                      ctn: it.qtyPerCtn > 0 ? parseFloat((pcs / it.qtyPerCtn).toFixed(4)) : 0,
                    }
                  : it
              ),
            }
          : d
      )
    )
  }

  function removeItem(key: string, itemIndex: number) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key ? { ...d, items: d.items.filter((_, i) => i !== itemIndex) } : d
      )
    )
  }

  // ── Readiness + totals ──────────────────────────────────────────────────────

  const readiness = useMemo(() => {
    return drafts.map((d) => {
      const usableItems = d.items.filter(
        (it) => it.productValue && it.pcs > 0 && it.ratePerPcs != null && it.ratePerPcs >= 0
      )
      const needsBank = d.companyId === 'bankaccount'
      const blockers: string[] = []
      if (!d.companyId) blockers.push('Pick a company')
      if (needsBank && !d.bankAccountId) blockers.push('Pick a bank account')
      if (!d.billDate) blockers.push('Pick a date')
      if (!usableItems.length) blockers.push('Needs at least one product with quantity and rate')
      const total = usableItems.reduce((s, it) => s + it.pcs * (it.ratePerPcs ?? 0), 0)
      return { key: d.key, ready: blockers.length === 0, blockers, total, usableItems }
    })
  }, [drafts])

  const readyByKey = useMemo(
    () => new Map(readiness.map((r) => [r.key, r])),
    [readiness]
  )

  const includedReady = drafts.filter(
    (d) => d.include && readyByKey.get(d.key)?.ready
  )
  const grandTotal = includedReady.reduce(
    (s, d) => s + (readyByKey.get(d.key)?.total ?? 0),
    0
  )

  // ── Create ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!includedReady.length) return
    setSaving(true)

    const payloadBills = includedReady.map((d) => {
      const r = readyByKey.get(d.key)!
      return {
        companyId: d.companyId,
        bankAccountId: d.companyId === 'bankaccount' ? d.bankAccountId : undefined,
        billDate: d.billDate,
        notes: d.notes || undefined,
        items: r.usableItems.map((it) => {
          const [source, id] = (it.productValue as string).split(':')
          return {
            productSource: source as 'china' | 'india',
            productId: id,
            pcs: it.pcs,
            ratePerPcs: it.ratePerPcs as number,
          }
        }),
      }
    })

    // Teach the matcher every mapping the user just confirmed on screen.
    const aliases: {
      raw: string
      targetType: 'product' | 'company' | 'bank'
      productSource?: 'china' | 'india'
      targetId: string
    }[] = []
    for (const d of includedReady) {
      if (d.companyRaw && d.companyId && d.companyId !== 'cashbook' && d.companyId !== 'bankaccount') {
        aliases.push({ raw: d.companyRaw, targetType: 'company', targetId: d.companyId })
      }
      if (d.companyId === 'bankaccount' && d.bankAccountRaw && d.bankAccountId) {
        aliases.push({ raw: d.bankAccountRaw, targetType: 'bank', targetId: d.bankAccountId })
      }
      for (const it of readyByKey.get(d.key)!.usableItems) {
        const [source, id] = (it.productValue as string).split(':')
        aliases.push({
          raw: it.productRaw,
          targetType: 'product',
          productSource: source as 'china' | 'india',
          targetId: id,
        })
      }
    }

    const res = await apiPost<{ results: BatchResult[]; createdCount: number; failedCount: number }>(
      '/api/sell-bills/batch',
      { bills: payloadBills, aliases }
    )
    setSaving(false)

    if (!res.success) {
      toast.error(res.message)
      return
    }

    const { createdCount, failedCount } = res.data
    setResults(res.data.results)
    if (failedCount === 0) {
      toast.success(`Created ${createdCount} bill${createdCount === 1 ? '' : 's'}`)
      // Drop the drafts that succeeded so a stray re-submit can't duplicate them.
      setDrafts([])
    } else {
      toast.warning(`Created ${createdCount}, ${failedCount} failed — see details below`)
      const failedIndexes = new Set(
        res.data.results.filter((r) => !r.success).map((r) => r.index)
      )
      setDrafts(includedReady.filter((_, i) => failedIndexes.has(i)).map((d) => ({ ...d })))
    }
  }

  function reset() {
    setDrafts([])
    setUnparsed([])
    setResults(null)
    setRawText('')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const showPasteBox = drafts.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quick Bill from Message"
        breadcrumb={
          <>
            <Link href="/sale-bills" className="text-muted-foreground hover:text-foreground">
              Sale Bills
            </Link>
            <span className="text-muted-foreground"> / Quick Bill</span>
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

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {results && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <h3 className="font-semibold text-sm">Result</h3>
          {results.map((r) => (
            <div key={r.index} className="flex items-center gap-2 text-sm">
              {r.success ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>
                    Bill #{r.billNumber} created — ₹{(r.grandTotal ?? 0).toLocaleString('en-IN')}
                  </span>
                  <Link
                    href={`/sale-bills/${r.billId}`}
                    className="text-primary hover:underline text-xs"
                  >
                    view
                  </Link>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">
                    Bill {r.index + 1} failed: {r.message}
                  </span>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={reset}>
              Paste another message
            </Button>
            <Button size="sm" onClick={() => router.push('/sale-bills')}>
              Go to Sale Bills
            </Button>
          </div>
        </div>
      )}

      {/* ── Paste box ───────────────────────────────────────────────────────── */}
      {showPasteBox && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Paste your WhatsApp messages</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste one or many messages. Each becomes a draft bill you review before anything is
              saved. Company and product names are matched against your records, and every
              correction you make is remembered for next time.
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
              Item lines read as{' '}
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">
                3 ctn - product name @rate
              </code>{' '}
              — the rate is per piece. Word order and spacing don&rsquo;t matter.
            </p>
          </div>

          <textarea
            className="flex min-h-[260px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <Link href="/sale-bills">Cancel</Link>
            </Button>
          </div>

          {unparsed.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-400">
                Skipped {unparsed.length} message
                {unparsed.length === 1 ? '' : 's'} with no quantity line:
              </p>
              <pre className="mt-1 whitespace-pre-wrap text-[11px] text-amber-700 dark:text-amber-500">
                {unparsed.join('\n---\n')}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Draft review ────────────────────────────────────────────────────── */}
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
                  `Create ${includedReady.length} Bill${includedReady.length === 1 ? '' : 's'}`
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {drafts.map((draft) => {
              const r = readyByKey.get(draft.key)
              const isBankSale = draft.companyId === 'bankaccount'
              return (
                <div
                  key={draft.key}
                  className={cn(
                    'rounded-lg border p-4 space-y-3',
                    !draft.include && 'opacity-50',
                    r && !r.ready && draft.include && 'border-amber-300 dark:border-amber-800'
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={draft.include ?? true}
                        onChange={(e) => updateDraft(draft.key, { include: e.target.checked })}
                      />
                      Include this bill
                    </label>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Bill total</div>
                      <div className="font-semibold">
                        ₹{(r?.total ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Original message */}
                  <pre className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px] text-muted-foreground font-mono">
                    {draft.sourceText}
                  </pre>

                  {/* Company + date */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Company *</Label>
                        {draft.companyRaw && <ConfidenceBadge confidence={draft.companyConfidence} />}
                        {draft.companyRaw && (
                          <span className="text-[11px] text-muted-foreground truncate">
                            from &ldquo;{draft.companyRaw}&rdquo;
                          </span>
                        )}
                        {draft.assumedCashbook && (
                          <span className="text-[11px] text-muted-foreground truncate">
                            no company in message — assumed Cashbook
                          </span>
                        )}
                      </div>
                      <CompanySelect
                        options={companyOptions}
                        value={draft.companyId ?? ''}
                        onValueChange={(v) =>
                          updateDraft(draft.key, {
                            companyId: v,
                            companyConfidence: 'exact',
                            warnings: [],
                            bankAccountId: v === 'bankaccount' ? draft.bankAccountId : undefined,
                          })
                        }
                        onRequestAdd={(name) =>
                          setAddCompanyFor({
                            key: draft.key,
                            name: name || draft.companyRaw || '',
                          })
                        }
                      />
                      {isBankSale && (
                        <>
                        {draft.bankAccountRaw && (
                          <div className="flex items-center gap-2 pt-1">
                            <ConfidenceBadge confidence={draft.bankConfidence} />
                            <span className="text-[11px] text-muted-foreground truncate">
                              bank from &ldquo;{draft.bankAccountRaw}&rdquo;
                            </span>
                          </div>
                        )}
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.bankAccountId ?? ''}
                          onChange={(e) =>
                            updateDraft(draft.key, {
                              bankAccountId: e.target.value,
                              bankConfidence: 'exact',
                              warnings: [],
                            })
                          }
                        >
                          <option value="">Select bank account</option>
                          {bankAccounts.map((b) => (
                            <option key={b._id} value={b._id}>
                              {b.accountName} — ₹{b.currentBalance.toLocaleString('en-IN')}
                            </option>
                          ))}
                        </select>
                        </>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Bill Date *</Label>
                      <Input
                        type="date"
                        value={draft.billDate}
                        onChange={(e) => updateDraft(draft.key, { billDate: e.target.value })}
                      />
                    </div>
                  </div>

                  <WarningList warnings={draft.warnings} />

                  {/* Items */}
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="h-9 px-3 text-left font-medium">Product</th>
                          <th className="h-9 px-3 text-right font-medium w-24">CTN</th>
                          <th className="h-9 px-3 text-right font-medium w-24">PCS</th>
                          <th className="h-9 px-3 text-right font-medium w-28">Rate/PCS</th>
                          <th className="h-9 px-3 text-right font-medium w-28">Total</th>
                          <th className="h-9 w-10 px-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {draft.items.map((item, i) => (
                          <tr key={i} className="border-b align-top last:border-0">
                            <td className="p-2 min-w-[240px]">
                              <div className="flex items-center gap-2 mb-1">
                                <ConfidenceBadge confidence={item.confidence} />
                                <span className="text-[11px] text-muted-foreground truncate">
                                  from &ldquo;{item.productRaw}&rdquo;
                                </span>
                              </div>
                              <ProductSelect
                                value={item.productValue ?? ''}
                                selectedLabel={item.productLabel ?? ''}
                                onValueChange={(v, label, qtyPerCtn, availableCtn) =>
                                  setItemProduct(draft.key, i, v, label, qtyPerCtn, availableCtn)
                                }
                              />
                              {item.productValue && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Available: {item.availableCtn} CTN (
                                  {item.availablePcs.toLocaleString('en-IN')} pcs)
                                  {item.qtyPerCtn > 0 && ` · ${item.qtyPerCtn} pcs/ctn`}
                                </p>
                              )}
                              <WarningList warnings={item.warnings} />
                            </td>
                            <td className="p-2 pt-8">
                              <NumberInput
                                placeholder="0"
                                value={item.ctn === 0 ? undefined : item.ctn}
                                onChange={(v) => setItemCtn(draft.key, i, v ?? 0)}
                                decimal
                                min={0}
                                step={0.01}
                                className="w-24 text-right"
                              />
                            </td>
                            <td className="p-2 pt-8">
                              <NumberInput
                                placeholder="0"
                                value={item.pcs === 0 ? undefined : item.pcs}
                                onChange={(v) => setItemPcs(draft.key, i, v ?? 0)}
                                decimal={false}
                                min={0}
                                className="w-24 text-right"
                              />
                            </td>
                            <td className="p-2 pt-8">
                              <NumberInput
                                placeholder="Rate"
                                prefix="₹"
                                value={item.ratePerPcs ?? undefined}
                                onChange={(v) =>
                                  updateItem(draft.key, i, { ratePerPcs: v ?? null })
                                }
                                min={0}
                                className="text-right"
                              />
                            </td>
                            <td className="p-2 pt-8 text-right font-medium">
                              ₹
                              {(item.pcs * (item.ratePerPcs ?? 0)).toLocaleString('en-IN', {
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="p-2 pt-7">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeItem(draft.key, i)}
                                aria-label="Remove item"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {draft.notes && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Note from message:</span> {draft.notes}
                    </p>
                  )}

                  {draft.include && r && !r.ready && (
                    <div className="rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
                      <WarningList warnings={r.blockers} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
