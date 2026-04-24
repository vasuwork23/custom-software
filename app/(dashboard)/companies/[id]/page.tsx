'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, Pencil, FileText, Wallet, Plus, Trash2, MessageCircle, Download, Phone } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
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
  paymentMode: 'cash' | 'online' | 'set_off'
  bankAccount?: { accountName: string }
  remark?: string
  companyNote?: string
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
  const [downloadingOutstanding, setDownloadingOutstanding] = useState(false)
  const [sendingOutstanding, setSendingOutstanding] = useState(false)
  const [sendPdfOpen, setSendPdfOpen] = useState(false)
  const [sendPdfPhone, setSendPdfPhone] = useState('')

  const fetchCompany = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<CompanyDetailData>(`/api/companies/${id}`)
    setLoading(false)
    if (result.success) {
      setData(result.data)
    } else {
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
  const mobiles = [company.primaryMobile, company.contact1Mobile, company.contact2Mobile]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ')

  const defaultPhone =
    company.primaryMobile ?? company.contact1Mobile ?? company.contact2Mobile ?? ''

  function handleOpenSendPdf() {
    setSendPdfPhone(defaultPhone)
    setSendPdfOpen(true)
  }

  function handleDownloadOutstanding() {
    setDownloadingOutstanding(true)
    fetch(`/api/companies/${id}/outstanding-pdf`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to generate outstanding PDF')
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
      })
      .catch((err) => {
        console.error(err)
        toast.error('Failed to download outstanding statement')
      })
      .finally(() => setDownloadingOutstanding(false))
  }

  async function handleSendPdfOnWhatsApp() {
    const phone = sendPdfPhone.trim()
    if (!phone) {
      toast.error('Enter a WhatsApp number')
      return
    }
    setSendingOutstanding(true)
    const result = await apiPost(`/api/companies/${id}/whatsapp-outstanding`, {
      mobileNumber: phone,
    })
    setSendingOutstanding(false)
    if (!result.success) {
      toast.error(result.message ?? 'Failed to send')
      return
    }
    toast.success('Outstanding PDF sent on WhatsApp')
    setSendPdfOpen(false)
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
              onClick={handleOpenSendPdf}
              disabled={sendingOutstanding}
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Send Outstanding
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
                No sale bills yet.
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
                    <th className="h-10 px-4 text-left font-medium">Company Note</th>
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
                              : p.paymentMode === 'set_off'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          )}
                        >
                          {p.paymentMode === 'cash' ? 'Cash' : p.paymentMode === 'set_off' ? 'Set-off' : 'Online'}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {p.paymentMode === 'online' && p.bankAccount
                          ? p.bankAccount.accountName
                          : p.paymentMode === 'cash'
                            ? 'Cash'
                            : p.paymentMode === 'set_off'
                              ? 'India Buying Set-off'
                              : '—'}
                      </td>
                      <td className="p-4 text-muted-foreground">{p.remark ?? '—'}</td>
                      <td className="p-4 text-muted-foreground max-w-[180px] truncate">{p.companyNote ?? '—'}</td>
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

      {/* Send Outstanding PDF via WhatsApp */}
      <Dialog open={sendPdfOpen} onOpenChange={setSendPdfOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              Send Outstanding PDF
            </DialogTitle>
            <DialogDescription>
              The outstanding statement PDF for{' '}
              <span className="font-medium text-foreground">{company.companyName}</span> will be
              sent to the number below via WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="mb-1.5 block text-sm font-medium">WhatsApp number</label>
            <input
              type="tel"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. 9800XXXXXX"
              value={sendPdfPhone}
              onChange={(e) => setSendPdfPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Outstanding: <AmountDisplay amount={outstanding} />
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendPdfOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSendPdfOnWhatsApp}
              disabled={sendingOutstanding}
            >
              {sendingOutstanding ? 'Sending...' : 'Send PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  )
}
