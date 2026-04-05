'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, Pencil, FileText, Wallet, Plus, Trash2, MessageCircle, Download, Phone, Copy, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatCard } from '@/components/ui/StatCard'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { CompanyFormSheet } from '@/components/companies/CompanyFormSheet'
import { PaymentFormDialog, type PaymentFormValues } from '@/components/received-voucher/PaymentFormDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiDelete, apiPost, authHeaders } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { format } from 'date-fns'
import { cn, generateOutstandingFileName } from '@/lib/utils'

interface SellingRow {
  _id: string
  billNumber: number
  billDate: string
  products: number
  totalCtn: number
  totalAmount: number
  profit: number
}

interface PaymentRow {
  _id: string
  paymentDate: string
  amount: number
  paymentMode: 'cash' | 'online'
  bankAccount?: { accountName: string }
  remark?: string
}

interface CompanyDetailData {
  company: {
    _id: string
    companyName: string
    ownerName?: string
    contact1Name?: string
    contact1Mobile?: string
    contact2Name?: string
    contact2Mobile?: string
    gstNumber?: string
    address?: string
    city?: string
    primaryMobile?: string
    openingBalance?: number
    openingBalanceNotes?: string
    lastWhatsappSentAt?: string
  }
  totalBilled: number
  totalReceived: number
  outstanding: number
  totalProfit: number
  sellingHistory: SellingRow[]
  paymentHistory: PaymentRow[]
}

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [data, setData] = useState<CompanyDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<PaymentFormValues | null>(null)
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [whatsappMode, setWhatsappMode] = useState<'outstanding' | 'custom'>('outstanding')
  const [whatsappMessage, setWhatsappMessage] = useState('')
  const [downloadingOutstanding, setDownloadingOutstanding] = useState(false)
  const [sendingOutstanding, setSendingOutstanding] = useState(false)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchCompany = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<CompanyDetailData>(`/api/companies/${id}`)
    setLoading(false)
    if (result.success) {
      setData(result.data)
    } else {
      // If company is not found (e.g. deleted in another tab), silently redirect
      router.push('/companies')
    }
  }, [id, router])

  useEffect(() => {
    fetchCompany()
  }, [fetchCompany])

  if (loading || !data) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  const { company, totalBilled, totalReceived, outstanding, totalProfit, sellingHistory, paymentHistory } = data
  const mobiles = [company.primaryMobile, company.contact1Mobile, company.contact2Mobile].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')

  function buildOutstandingMessage(): string {
    const formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
    const lines: string[] = []
    lines.push(`Dear ${company.companyName},`)
    lines.push('')
    lines.push('This is a reminder for your outstanding payment.')
    lines.push('')
    lines.push(`Outstanding Amount: ₹${formatter.format(outstanding)}`)
    if (sellingHistory.length) {
      lines.push('')
      lines.push('Bill wise breakdown:')
      sellingHistory.slice(0, 10).forEach((row) => {
        const date = format(new Date(row.billDate), 'dd MMM yyyy')
        lines.push(`- INV-${row.billNumber} dated ${date}: ₹${formatter.format(row.totalAmount)}`)
      })
    }
    lines.push('')
    lines.push('Please clear the payment at your earliest convenience.')
    lines.push('')
    lines.push('Thank you,')
    lines.push('Import Export')
    return lines.join('\n')
  }

  function handleOpenWhatsapp(mode: 'outstanding' | 'custom') {
    setWhatsappMode(mode)
    if (mode === 'outstanding') {
      setWhatsappMessage(buildOutstandingMessage())
    } else {
      setWhatsappMessage('')
    }
    setWhatsappOpen(true)
  }

  function handleDownloadOutstanding() {
    setDownloadingOutstanding(true)
    fetch(`/api/companies/${id}/outstanding-pdf`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to generate outstanding PDF')
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = generateOutstandingFileName(company.companyName)
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast.success('Outstanding statement downloaded')
        if (mobiles) {
          setDownloadModalOpen(true)
          setCopied(false)
        }
      })
      .catch((err) => {
        console.error(err)
        toast.error('Failed to download outstanding statement')
      })
      .finally(() => setDownloadingOutstanding(false))
  }

  async function handleSendWhatsapp() {
    if (!whatsappMessage.trim()) {
      toast.error('Message cannot be empty')
      return
    }
    setSendingOutstanding(true)
    const result = await apiPost(`/api/companies/${id}/whatsapp-outstanding`, {
      customMessage: whatsappMessage,
    })
    setSendingOutstanding(false)
    if (!result.success) {
      toast.error(result.message)
      return
    }
    toast.success('Outstanding statement sent on WhatsApp')
    setWhatsappOpen(false)
    fetchCompany()
  }

  async function openEditPayment(paymentId: string) {
    const result = await apiGet<PaymentFormValues>(`/api/received-voucher/${paymentId}`)
    if (result.success) {
      setEditingPayment(result.data)
      setPaymentDialogOpen(true)
    } else toast.error(result.message)
  }

  async function handleDeletePayment(paymentId: string) {
    const result = await apiDelete(`/api/received-voucher/${paymentId}`)
    if (result.success) {
      toast.success('Voucher deleted')
      fetchCompany()
    } else toast.error(result.message)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>{company.companyName}</span>
            {(company.primaryMobile ?? company.contact1Mobile ?? company.contact2Mobile) && (
              <a
                href={`tel:${company.primaryMobile ?? company.contact1Mobile ?? company.contact2Mobile}`}
                className="flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                {company.primaryMobile ?? company.contact1Mobile ?? company.contact2Mobile}
              </a>
            )}
          </div>
        }
        description={
          [company.ownerName, mobiles].filter(Boolean).join(' · ') || undefined
        }
        breadcrumb={
          <>
            <Link href="/companies" className="text-muted-foreground hover:text-foreground">
              Companies
            </Link>
            <span className="text-muted-foreground"> / </span>
            <span>{company.companyName}</span>
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadOutstanding}
                  disabled={downloadingOutstanding}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {downloadingOutstanding ? 'Downloading...' : 'Download Outstanding'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleOpenWhatsapp('outstanding')}
                  disabled={sendingOutstanding || !mobiles}
                  title={!mobiles ? 'Add mobile number to company first' : undefined}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  {sendingOutstanding ? 'Sending...' : 'Send Outstanding'}
                </Button>
            <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Company
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Billed"
          value={<AmountDisplay amount={totalBilled} />}
          icon={FileText}
        />
        <StatCard
          title="Total Receive"
          value={<AmountDisplay amount={totalReceived} />}
          icon={Wallet}
        />
        <StatCard
          title={outstanding < 0 ? 'Credit Balance' : 'Outstanding'}
          value={
            outstanding < 0 ? (
              <AmountDisplay amount={Math.abs(outstanding)} />
            ) : outstanding === 0 ? (
              <span className="text-green-600 font-semibold">Clear ✅</span>
            ) : (
              <AmountDisplay amount={outstanding} />
            )
          }
          icon={Building2}
          className={
            outstanding > 0
              ? 'border-red-500/60 bg-red-50'
              : outstanding === 0
              ? 'border-green-500/60 bg-green-50'
              : 'border-blue-500/60 bg-blue-50'
          }
        />
        <StatCard
          title="Total Profit"
          value={<AmountDisplay amount={totalProfit} />}
          icon={FileText}
        />
      </div>

      <Tabs defaultValue="selling" className="space-y-4">
        <TabsList>
          <TabsTrigger value="selling">Selling History</TabsTrigger>
          <TabsTrigger value="received-voucher">Received Voucher</TabsTrigger>
        </TabsList>
        <TabsContent value="selling" className="space-y-4">
          <div className="rounded-md border overflow-x-auto">
            {sellingHistory.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No sale bills yet. Selling history will appear here after Phase 6 (Sale Bills).
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium">Bill No</th>
                    <th className="h-10 px-4 text-left font-medium">Date</th>
                    <th className="h-10 px-4 text-right font-medium">Products</th>
                    <th className="h-10 px-4 text-right font-medium">CTN</th>
                    <th className="h-10 px-4 text-right font-medium">Amount</th>
                    <th className="h-10 px-4 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {sellingHistory.map((row) => (
                    <tr
                      key={row._id}
                      className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                      onClick={() => router.push(`/sale-bills/${row._id}`)}
                    >
                      <td className="p-4 font-medium">{row.billNumber}</td>
                      <td className="p-4">{format(new Date(row.billDate), 'dd MMM yyyy')}</td>
                      <td className="p-4 text-right">{row.products}</td>
                      <td className="p-4 text-right">{row.totalCtn}</td>
                      <td className="p-4 text-right">
                        <AmountDisplay amount={row.totalAmount} />
                      </td>
                      <td className="p-4 text-right">
                        <AmountDisplay amount={row.profit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
        <TabsContent value="received-voucher" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingPayment(null); setPaymentDialogOpen(true) }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Voucher
            </Button>
          </div>
          <div className="rounded-md border overflow-x-auto">
            {paymentHistory.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No vouchers received yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium">Date</th>
                    <th className="h-10 px-4 text-right font-medium">Amount</th>
                    <th className="h-10 px-4 text-center font-medium">Mode</th>
                    <th className="h-10 px-4 text-left font-medium">Bank Account</th>
                    <th className="h-10 px-4 text-left font-medium">Remark</th>
                    <th className="h-10 w-24 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((p) => (
                    <tr key={p._id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4">{format(new Date(p.paymentDate), 'dd MMM yyyy')}</td>
                      <td className="p-4 text-right">
                        <AmountDisplay amount={p.amount} />
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            p.paymentMode === 'cash'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          )}
                        >
                          {p.paymentMode === 'cash' ? 'Cash' : 'Online'}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {p.paymentMode === 'online' && p.bankAccount
                          ? p.bankAccount.accountName
                          : p.paymentMode === 'cash'
                            ? 'Cash'
                            : '—'}
                      </td>
                      <td className="p-4 text-muted-foreground">{p.remark ?? '—'}</td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditPayment(p._id)} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <ConfirmDialog
                            title="Delete voucher"
                            description="This will reverse the bank transaction. This cannot be undone."
                            confirmLabel="Delete"
                            variant="destructive"
                            onConfirm={() => handleDeletePayment(p._id)}
                            trigger={
                              <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex justify-end border-t pt-4">
            <p className="text-sm font-medium">
              Total Billed – Total Received = Outstanding: <AmountDisplay amount={outstanding} className="font-semibold" />
            </p>
          </div>
          <PaymentFormDialog
            open={paymentDialogOpen}
            onOpenChange={(open) => { setPaymentDialogOpen(open); if (!open) setEditingPayment(null) }}
            onSuccess={() => { fetchCompany(); setPaymentDialogOpen(false); setEditingPayment(null) }}
            editPayment={editingPayment}
            preselectedCompanyId={id}
            preselectedCompanyName={company.companyName}
          />
        </TabsContent>
      </Tabs>

      {/* WhatsApp Outstanding Dialog */}
      {whatsappOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  WhatsApp outstanding reminder
                </h2>
                <p className="text-xs text-muted-foreground">
                  Outstanding: <AmountDisplay amount={outstanding} />
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setWhatsappOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mb-3 flex gap-2 text-xs">
              <button
                type="button"
                className={`rounded border px-2 py-1 ${
                  whatsappMode === 'outstanding'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => handleOpenWhatsapp('outstanding')}
              >
                Use outstanding template
              </button>
              <button
                type="button"
                className={`rounded border px-2 py-1 ${
                  whatsappMode === 'custom'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => handleOpenWhatsapp('custom')}
              >
                Custom message
              </button>
            </div>
            <textarea
              className="mb-4 h-48 w-full rounded-md border bg-background p-2 text-sm"
              value={whatsappMessage}
              onChange={(e) => setWhatsappMessage(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWhatsappOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleSendWhatsapp}>
                Send on WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}

      <CompanyFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={fetchCompany}
        editCompany={{
          _id: company._id,
          companyName: company.companyName,
          ownerName: company.ownerName,
          contact1Name: company.contact1Name,
          contact1Mobile: company.contact1Mobile,
          contact2Name: company.contact2Name,
          contact2Mobile: company.contact2Mobile,
          gstNumber: company.gstNumber,
          address: company.address,
          city: company.city,
          primaryMobile: company.primaryMobile,
          openingBalance: company.openingBalance,
          openingBalanceNotes: company.openingBalanceNotes,
        }}
      />

      <Dialog open={downloadModalOpen} onOpenChange={setDownloadModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PDF Downloaded</DialogTitle>
            <DialogDescription>
              The Outstanding Statement has been successfully downloaded. Use the WhatsApp button to share directly, or copy the customer&apos;s mobile number below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 my-2">
            <div className="flex-1 bg-muted px-4 py-2 rounded-md font-medium text-base border">
              {mobiles || 'No mobile number added'}
            </div>
            {mobiles && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(mobiles)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDownloadModalOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
