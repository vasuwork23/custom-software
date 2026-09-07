'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle, Archive, CheckCircle2, Download, FileDown, Loader2,
  RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiGet, apiPost, authHeaders } from '@/lib/api-client'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'

/* ── shapes returned by the API ─────────────────────────────────────── */
interface PreflightCheck {
  id: string; label: string; severity: 'blocker' | 'warning'
  passed: boolean; summary: string; details: string[]
}
interface PreflightReport {
  ranAt: string; canProceed: boolean; blockers: number; warnings: number
  checks: PreflightCheck[]; scope: Record<string, number>
}
interface InTransitRow {
  id: string; mark: string; product: string
  transitCtn: number; availableCtn: number; valueInr: number; release: boolean
}
interface CompanyCarry {
  id: string; name: string; oldOpening: number; billed: number; received: number; newOpening: number
}
interface TrimRow {
  id: string; mark: string; product: string; releasedFromTransit: number
  before: { totalCtn: number; available: number; transit: number; sold: number; totalAmount: number; given: number; lockedAmount: number }
  after: { totalCtn: number; available: number; transit: number; totalAmount: number; given: number; openingGiven: number; lockedAmount: number; status: string }
}
interface DropRow { id: string; mark: string; product: string; totalCtn: number; sold: number; lockedAmount: number }
interface ResetPlan {
  builtAt: string; resetAt: string
  ledgers: {
    chinaBank: number; cash: number
    banks: { id: string; name: string; balance: number }[]
    suppliers: { id: string; name: string; balance: number }[]
    investors: { id: string; name: string; balance: number }[]
  }
  companies: CompanyCarry[]
  china: { drop: DropRow[]; trim: TrimRow[]; carry: { id: string }[] }
  india: { drop: DropRow[]; carry: { id: string }[] }
  wipe: Record<string, number>
  counter: { from: number; to: number; nextBillNumber: number }
  inTransit: InTransitRow[]
  totals: {
    outstandingCarried: number; companiesOwing: number; companiesInCredit: number
    sunkLockedAmount: number; chinaStockValue: number; indiaStockValue: number
    documentsRemoved: number
  }
}
interface ExecuteResult {
  resetRunId: string; documentsBefore: number; documentsAfter: number
  archiveDbName: string; snapshotPath: string; nextBillNumber: number
  verify: { checked: number; failures: string[] }
  carried: { outstanding: number; chinaBank: number; cash: number }
}
interface RunRow {
  _id: string; status: string; startedAt: string; completedAt?: string
  snapshotPath?: string; archiveDbName?: string; error?: string; notes?: string
}
interface SnapshotResult {
  resetRunId: string; snapshotPath: string; archiveDbName: string
  collections: number; documents: number
}

const REPORTS = ['pnl', 'stock', 'selling', 'buying'] as const
const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function YearEndResetPage() {
  const user = useAuthStore((s) => s.user)
  const isOwner = user?.role === 'owner'

  const [report, setReport] = useState<PreflightReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [password, setPassword] = useState('')
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null)
  const [snapping, setSnapping] = useState(false)
  const [release, setRelease] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<ResetPlan | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<ExecuteResult | null>(null)
  const [runs, setRuns] = useState<RunRow[]>([])

  const runCheck = useCallback(async () => {
    setChecking(true)
    const res = await apiGet<PreflightReport>('/api/admin/year-reset/preflight')
    if (res.success) setReport(res.data)
    else toast.error(res.message ?? 'Could not run the check')
    setChecking(false)
  }, [])

  const loadRuns = useCallback(async () => {
    const res = await apiGet<{ runs: RunRow[] }>('/api/admin/year-reset/snapshot')
    if (res.success) setRuns(res.data.runs)
  }, [])

  useEffect(() => { if (isOwner) { runCheck(); loadRuns() } }, [isOwner, runCheck, loadRuns])

  /* the reset sweeps everything, so the closing reports cover everything */
  const reportRange = useMemo(
    () => `period=year&startDate=2000-01-01&endDate=${format(new Date(), 'yyyy-MM-dd')}`,
    []
  )

  const download = useCallback(async (reportType: string, fmt: 'pdf' | 'excel') => {
    const key = `${reportType}-${fmt}`
    try {
      const res = await fetch(
        `/api/reports/export?format=${fmt}&reportType=${reportType}&${reportRange}`,
        { headers: authHeaders() }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j.message ?? 'Download failed')
        return
      }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `closing-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`
      link.click()
      URL.revokeObjectURL(link.href)
      setTaken((prev) => new Set(prev).add(key))
    } catch {
      toast.error('Download failed')
    }
  }, [reportRange])

  const allReportsTaken = REPORTS.every((r) => taken.has(`${r}-pdf`) && taken.has(`${r}-excel`))

  const takeSnapshot = useCallback(async () => {
    if (!password) { toast.error('Enter your password first'); return }
    setSnapping(true)
    const res = await apiPost<SnapshotResult>('/api/admin/year-reset/snapshot', { password })
    if (res.success) {
      setSnapshot(res.data)
      loadRuns()
      toast.success('Snapshot and archive complete')
    } else {
      toast.error(res.message ?? 'Snapshot failed')
    }
    setSnapping(false)
  }, [password, loadRuns])

  const buildPreview = useCallback(async () => {
    if (!password) { toast.error('Enter your password first'); return }
    setPreviewing(true)
    const res = await apiPost<{ plan: ResetPlan }>('/api/admin/year-reset/preview', {
      password,
      releaseInTransit: Array.from(release),
      counterSeq: 1000,
    })
    if (res.success) setPlan(res.data.plan)
    else toast.error(res.message ?? 'Could not build the preview')
    setPreviewing(false)
  }, [password, release])

  const runReset = useCallback(async () => {
    setRunning(true)
    const res = await apiPost<ExecuteResult>('/api/admin/year-reset/execute', {
      password, confirm, releaseInTransit: Array.from(release), counterSeq: 1000,
    })
    if (res.success) {
      setDone(res.data)
      loadRuns()
      toast.success('Reset complete')
    } else {
      toast.error(res.message ?? 'Reset failed')
    }
    setRunning(false)
  }, [password, confirm, release, loadRuns])

  const downloadCsv = useCallback(() => {
    if (!plan) return
    const rows: string[] = ['Company,Old opening,Billed,Received,New opening']
    for (const c of plan.companies) {
      rows.push([`"${c.name.replace(/"/g, '""')}"`, c.oldOpening, c.billed, c.received, c.newOpening].join(','))
    }
    rows.push('', 'Entry,Mark,Before CTN,After CTN,Sold,Before given,After given,Opening given')
    for (const t of plan.china.trim) {
      rows.push([t.id, `"${t.mark.replace(/"/g, '""')}"`, t.before.totalCtn, t.after.totalCtn,
        t.before.sold, t.before.given, t.after.given, t.after.openingGiven].join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `reset-plan-${format(new Date(), 'yyyy-MM-dd')}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }, [plan])

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <PageHeader title="Year-End Reset" />
        <Card><CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <span>Only the owner can run the year-end reset.</span>
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeader title="Year-End Reset" />

      {/* ── 1. health check ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <StepHeading n={1} title="Check the books" done={!!report?.canProceed}>
          Compares every balance against the transactions behind it. It only reads, and
          never repairs — recomputing a balance from an incomplete history would hide a
          problem rather than show it to you.
        </StepHeading>

        <Card>
          <CardContent className="py-5">
            <Button onClick={runCheck} disabled={checking}>
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking…' : 'Run check'}
            </Button>
          </CardContent>
        </Card>

        {report && (
          <>
            <Card className={report.canProceed ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}>
              <CardContent className="flex flex-wrap items-center gap-3 py-5">
                {report.canProceed
                  ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                  : <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {report.canProceed
                      ? 'Everything reconciles.'
                      : `${report.blockers} thing${report.blockers === 1 ? '' : 's'} to sort out first.`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {report.canProceed
                      ? 'Every balance matches the transactions behind it.'
                      : 'Nothing further will run until each one below is resolved.'}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(report.ranAt).toLocaleString('en-IN')}
                </span>
              </CardContent>
            </Card>

            <Card><CardContent className="divide-y p-0">
              {report.checks.map((c) => (
                <div key={c.id} className="flex gap-3 px-5 py-4">
                  {c.passed
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.label}</span>
                      {!c.passed && <Badge variant="destructive">Blocking</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{c.summary}</p>
                    {c.details.length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 font-mono text-xs">
                        {c.details.map((d) => <li key={d} className="break-words">{d}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </>
        )}
      </section>

      {/* ── 2. closing reports ──────────────────────────────────────── */}
      <section className="space-y-3">
        <StepHeading n={2} title="Keep this year's reports" done={allReportsTaken}>
          These four reports are the only place the old year&rsquo;s figures stay readable once
          the history is cleared. Take all eight files before going further.
        </StepHeading>
        <Card><CardContent className="space-y-3 py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REPORTS.map((r) => (
              <div key={r} className="rounded-md border p-3">
                <div className="mb-2 font-medium capitalize">{r === 'pnl' ? 'Profit & Loss' : r}</div>
                <div className="flex gap-2">
                  {(['pdf', 'excel'] as const).map((f) => (
                    <Button key={f} size="sm"
                      variant={taken.has(`${r}-${f}`) ? 'secondary' : 'outline'}
                      onClick={() => download(r, f)}>
                      {taken.has(`${r}-${f}`)
                        ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
                      {f === 'pdf' ? 'PDF' : 'Excel'}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      </section>

      {/* ── 3. password + snapshot ──────────────────────────────────── */}
      <section className="space-y-3">
        <StepHeading n={3} title="Take the safety copies" done={!!snapshot}>
          A full dump on disk that can be put back wholesale, plus a frozen copy of this
          year kept as its own database. Nothing in your live data changes here.
        </StepHeading>
        <Card><CardContent className="space-y-4 py-5">
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="pw">Your password</Label>
            <Input id="pw" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="Required for every step below" />
          </div>
          <Button onClick={takeSnapshot} disabled={snapping || !report?.canProceed || !password}>
            {snapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
            {snapping ? 'Copying…' : 'Take snapshot and archive'}
          </Button>
          {!report?.canProceed && (
            <p className="text-sm text-muted-foreground">Clear the checks in step 1 first.</p>
          )}
          {snapshot && (
            <div className="space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                {snapshot.documents.toLocaleString('en-IN')} documents copied twice over.
              </p>
              <p className="font-mono text-xs break-all">{snapshot.snapshotPath}</p>
              <p className="font-mono text-xs break-all">{snapshot.archiveDbName}</p>
            </div>
          )}
        </CardContent></Card>
      </section>

      {/* ── 4. in-transit decisions + preview ───────────────────────── */}
      <section className="space-y-3">
        <StepHeading n={4} title="Decide and preview" done={!!plan}>
          Tick any shipment that has actually arrived — its cartons move into available
          stock. Everything else carries on as in transit. Then build the preview.
        </StepHeading>

        {plan && plan.inTransit.length > 0 && (
          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 text-left">Arrived?</th>
                    <th className="p-3 text-left">Mark</th>
                    <th className="p-3 text-left">Product</th>
                    <th className="p-3 text-right">In transit</th>
                    <th className="p-3 text-right">Available</th>
                    <th className="p-3 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.inTransit.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-3">
                        <input type="checkbox" className="h-4 w-4 accent-emerald-600"
                          checked={release.has(r.id)}
                          onChange={(e) => setRelease((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(r.id); else next.delete(r.id)
                            return next
                          })} />
                      </td>
                      <td className="p-3 font-medium">{r.mark}</td>
                      <td className="p-3 text-muted-foreground">{r.product}</td>
                      <td className="p-3 text-right tabular-nums">{r.transitCtn}</td>
                      <td className="p-3 text-right tabular-nums">{r.availableCtn}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.valueInr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        )}

        <Card><CardContent className="flex flex-wrap items-center gap-3 py-5">
          <Button onClick={buildPreview} disabled={previewing || !report?.canProceed || !password}>
            {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {previewing ? 'Building…' : plan ? 'Rebuild preview' : 'Build preview'}
          </Button>
          {plan && (
            <Button variant="outline" onClick={downloadCsv}>
              <Download className="mr-2 h-4 w-4" /> Download as CSV
            </Button>
          )}
          {release.size > 0 && (
            <span className="text-sm text-muted-foreground">
              {release.size} shipment{release.size === 1 ? '' : 's'} marked as arrived — rebuild to apply
            </span>
          )}
        </CardContent></Card>

        {plan && <PlanView plan={plan} />}
      </section>

      {/* ── history ─────────────────────────────────────────────────── */}
      {runs.length > 0 && (
        <section className="space-y-3">
          <div className="pt-2">
            <h2 className="text-lg font-semibold">Past runs</h2>
            <p className="text-sm text-muted-foreground">
              Where each year went, and whether it finished.
            </p>
          </div>
          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 text-left">When</th>
                    <th className="p-3 text-left">Outcome</th>
                    <th className="p-3 text-left">Kept at</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r._id} className="border-b last:border-0 align-top">
                      <td className="p-3 whitespace-nowrap">
                        {new Date(r.startedAt).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3">
                        <Badge variant={
                          r.status === 'executed' ? 'default'
                          : r.status === 'failed' ? 'destructive' : 'secondary'}>
                          {r.status === 'executed' ? 'Reset completed'
                            : r.status === 'snapshot' ? 'Copies taken'
                            : r.status === 'previewed' ? 'Started, not finished'
                            : r.status === 'rolled_back' ? 'Rolled back' : 'Failed'}
                        </Badge>
                        {r.notes && <div className="mt-1 text-xs text-muted-foreground">{r.notes}</div>}
                        {r.error && <div className="mt-1 text-xs text-destructive">{r.error}</div>}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {r.archiveDbName && <div className="break-all">{r.archiveDbName}</div>}
                        {r.snapshotPath && <div className="break-all text-muted-foreground">{r.snapshotPath}</div>}
                        {!r.archiveDbName && !r.snapshotPath && <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </section>
      )}

      {/* ── 5. execute ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <StepHeading n={5} title="Run the reset" done={!!done}>
          Builds the result on a copy, checks every balance against this preview, and only
          then swaps it in.
        </StepHeading>
        {done ? (
          <Card className="border-emerald-500/40 bg-emerald-500/5">
            <CardContent className="space-y-3 py-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                <p className="font-semibold">
                  Done — {done.verify.checked} checks passed, {done.documentsBefore.toLocaleString('en-IN')} documents became{' '}
                  {done.documentsAfter.toLocaleString('en-IN')}.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Outstanding carried" value={inr(done.carried.outstanding)} tone="good" />
                <Stat label="China Bank" value={inr(done.carried.chinaBank)} tone="good" />
                <Stat label="Next bill number" value={String(done.nextBillNumber)} />
              </div>
              <p className="text-sm text-muted-foreground">
                Your old year is kept in <span className="font-mono text-xs">{done.archiveDbName}</span> and at{' '}
                <span className="font-mono text-xs break-all">{done.snapshotPath}</span>.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="space-y-4 py-5">
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <p className="text-sm">
                This replaces your live data with the plan above. It runs on a copy first and only
                swaps once every balance matches — but once it does, the old year lives in the
                archive and the snapshot, not here.
              </p>
            </div>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="confirm">Type RESET to confirm</Label>
              <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" />
            </div>
            <Button variant="destructive" onClick={runReset}
              disabled={running || !plan || !snapshot || confirm !== 'RESET' || !password || !allReportsTaken}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
              {running ? 'Running…' : 'Run the reset'}
            </Button>
            {!allReportsTaken && <p className="text-sm text-muted-foreground">Take all eight report files in step 2 first.</p>}
            {!snapshot && <p className="text-sm text-muted-foreground">Take the snapshot in step 3 first.</p>}
            {!plan && <p className="text-sm text-muted-foreground">Build the preview in step 4 first.</p>}
          </CardContent></Card>
        )}
      </section>
    </div>
  )
}

/* ── small presentational pieces ────────────────────────────────────── */

function StepHeading({ n, title, done, children }: {
  n: number; title: string; done: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 pt-2">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        done ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>
        {done ? '✓' : n}
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border p-3">
      <div className={`text-lg font-semibold tabular-nums ${
        tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-destructive' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function PlanView({ plan }: { plan: ResetPlan }) {
  const t = plan.totals
  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-4 py-5">
        <h3 className="font-semibold">Carried forward</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Customer outstanding" value={inr(t.outstandingCarried)} tone="good" />
          <Stat label="China Bank" value={inr(plan.ledgers.chinaBank)} tone="good" />
          <Stat label="Cash" value={inr(plan.ledgers.cash)} tone="good" />
          <Stat label="Stock value (China + India)" value={inr(t.chinaStockValue + t.indiaStockValue)} tone="good" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t.companiesOwing} companies owing, {t.companiesInCredit} in credit ·{' '}
          {plan.ledgers.banks.length} bank accounts, {plan.ledgers.suppliers.length} suppliers,{' '}
          {plan.ledgers.investors.length} investors — each gets one opening entry.
        </p>
      </CardContent></Card>

      <Card><CardContent className="space-y-4 py-5">
        <h3 className="font-semibold">Cleared away</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Documents removed" value={t.documentsRemoved.toLocaleString('en-IN')} tone="bad" />
          <Stat label="Sale bills" value={String(plan.wipe.sellbills ?? 0)} tone="bad" />
          <Stat label="China entries removed" value={String(plan.china.drop.length)} tone="bad" />
          <Stat label="India entries removed" value={String(plan.india.drop.length)} tone="bad" />
        </div>
        <p className="text-sm text-muted-foreground">
          {plan.china.trim.length} China entries trimmed to what is left, {plan.china.carry.length} untouched.{' '}
          Bills restart at {plan.counter.nextBillNumber}. {inr(t.sunkLockedAmount)} of China Bank
          spend stays in the carried balance — that money went on goods that sold.
        </p>
      </CardContent></Card>

      {plan.china.trim.length > 0 && (
        <Card><CardContent className="p-0">
          <div className="border-b px-5 py-3 font-semibold">Entries being trimmed</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">Mark</th>
                  <th className="p-3 text-right">CTN before</th>
                  <th className="p-3 text-right">Sold</th>
                  <th className="p-3 text-right">CTN after</th>
                  <th className="p-3 text-right">Paid before</th>
                  <th className="p-3 text-right">Paid after</th>
                  <th className="p-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.china.trim.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">
                      {r.mark}
                      {r.releasedFromTransit > 0 && (
                        <Badge variant="secondary" className="ml-2">+{r.releasedFromTransit} arrived</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">{r.before.totalCtn}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{r.before.sold}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{r.after.totalCtn}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">¥{r.before.given}</td>
                    <td className="p-3 text-right tabular-nums">¥{r.after.given}</td>
                    <td className="p-3 capitalize">{r.after.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  )
}
