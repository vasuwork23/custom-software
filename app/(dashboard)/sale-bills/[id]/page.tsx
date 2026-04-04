'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileText, Pencil, Trash2, Download, MessageCircle, Copy, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiPost, apiDelete } from '@/lib/api-client'
import { authHeaders } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn, generateBillFileName } from '@/lib/utils'

interface FifoItem {
  buyingEntry: { _id: string; entryDate?: string }
  ctnConsumed: number
  pcsConsumed: number
  finalCost: number
  profit: number
}

interface BillItem {
  _id: string
  product?: { productName?: string }
  indiaProduct?: { productName?: string }
  ctnSold: number
  pcsSold: number
  ratePerPcs: number
  totalAmount: number
  totalProfit: number
  fifoNote?: string
  fifoBreakdown: FifoItem[]
}

interface BillDetail {
  _id: string
  billNumber: number
  billDate: string
  totalAmount: number
  extraCharges?: number
  extraChargesNote?: string
  discount?: number
  discountNote?: string
  grandTotal?: number
  totalProfit: number
  notes?: string
  whatsappSent: boolean
  whatsappSentAt?: string
  company?: {
    _id: string
    companyName?: string
    ownerName?: string
    contact1Mobile?: string
    contact2Mobile?: string
    address?: string
    city?: string
  } | null
  isCashbook?: boolean
  items: BillItem[]
}

export default function SellBillDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [bill, setBill] = useState<BillDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchBill = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<BillDetail>(`/api/sell-bills/${id}`)
    setLoading(false)
    if (result.success) setBill(result.data)
    else {
      toast.error(result.message)
      router.push('/sale-bills')
    }
  }, [id, router])

  useEffect(() => {
    fetchBill()
  }, [fetchBill])

  async function handleDownloadPdf() {
    if (!bill) {
      toast.error('Bill not loaded yet')
      return
    }
    const res = await fetch(`/api/sell-bills/${id}/pdf`, { headers: authHeaders() })
    if (!res.ok) {
      toast.error('Failed to generate PDF')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = generateBillFileName({
      companyName: bill.isCashbook ? 'Cashbook' : (bill.company?.companyName ?? '—'),
      billNumber: bill.billNumber,
      billDate: bill.billDate,
    })
    a.click()
    URL.revokeObjectURL(url)
    toast.success('PDF downloaded')
    if (mobile !== '—') {
      setDownloadModalOpen(true)
      setCopied(false)
    }
  }

  async function handleSendWhatsApp() {
    const mobile = bill?.company?.contact1Mobile || bill?.company?.contact2Mobile
    if (!mobile?.trim()) {
      toast.error('Company has no mobile number. Add a contact mobile to send WhatsApp.')
      return
    }
    setSendingWhatsApp(true)
    const result = await apiPost<{ sent: boolean }>(`/api/sell-bills/${id}/whatsapp`, {})
    setSendingWhatsApp(false)
    if (result.success) {
      toast.success('Bill sent on WhatsApp')
      fetchBill()
    } else toast.error(result.message)
  }

  async function handleDelete() {
    const result = await apiDelete(`/api/sell-bills/${id}`)
    if (result.success) {
      toast.success('Bill deleted')
      router.push('/sale-bills')
    } else toast.error(result.message)
  }

  function toggleRow(itemId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  if (loading || !bill) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  const mobile = bill.company ? [(bill.company as any).primaryMobile, bill.company.contact1Mobile, bill.company.contact2Mobile].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—' : '—'

  function formatCtnPcs(ctn: number, pcs: number): string {
    const isWhole = Number.isInteger(ctn)
    const formattedCtn = isWhole ? String(ctn) : ctn.toFixed(2)
    const perCtn = ctn > 0 ? Math.round(pcs / ctn) : 0
    return `${formattedCtn} CTN (${perCtn} pcs/ctn)`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bill #${bill.billNumber}`}
        description={format(new Date(bill.billDate), 'PPP')}
        breadcrumb={
          <>
            <Link href="/sale-bills" className="text-muted-foreground hover:text-foreground">
              Sale Bills
            </Link>
            <span className="text-muted-foreground"> / Bill #{bill.billNumber}</span>
          </>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sale-bills/${id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendWhatsApp}
              disabled={bill.isCashbook || bill.whatsappSent || sendingWhatsApp}
              title={bill.isCashbook ? 'Not available for Cashbook bills' : undefined}
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              {bill.isCashbook ? 'WhatsApp N/A' : bill.whatsappSent ? 'Sent' : sendingWhatsApp ? 'Sending...' : 'Send WhatsApp'}
            </Button>
            <ConfirmDialog
              title="Delete sale bill"
              description="This will reverse FIFO and restore stock. This cannot be undone."
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={handleDelete}
              trigger={
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              }
            />
          </div>
        }
      />

      <Card>
        <CardHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">To</p>
              {bill.isCashbook || !bill.company ? (
                <span className="font-medium text-green-700 dark:text-green-400">💵 Cashbook</span>
              ) : (
                <>
                  <Link href={`/companies/${bill.company._id}`} className="font-medium hover:underline">
                    {bill.company.companyName ?? '—'}
                  </Link>
                  {bill.company.ownerName && <p className="text-sm text-muted-foreground">{bill.company.ownerName}</p>}
                  <p className="text-sm text-muted-foreground">{mobile}</p>
                  {(bill.company.address || bill.company.city) && (
                    <p className="text-sm text-muted-foreground">
                      {[bill.company.address, bill.company.city].filter(Boolean).join(', ')}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="text-right space-y-1 text-sm">
              <div className="flex justify-between gap-4 text-muted-foreground">
                <span>Subtotal</span>
                <span>₹{bill.totalAmount.toLocaleString('en-IN')}</span>
              </div>
              {bill.extraCharges != null && bill.extraCharges > 0 && (
                <div className="flex justify-between gap-4 text-orange-600 dark:text-orange-400">
                  <span>Extra Charges {bill.extraChargesNote && `(${bill.extraChargesNote})`}</span>
                  <span>+₹{bill.extraCharges.toLocaleString('en-IN')}</span>
                </div>
              )}
              {bill.discount != null && bill.discount > 0 && (
                <div className="flex justify-between gap-4 text-green-600 dark:text-green-400">
                  <span>Discount {bill.discountNote && `(${bill.discountNote})`}</span>
                  <span>-₹{bill.discount.toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="flex justify-between gap-4 font-bold text-base border-t pt-1 mt-1">
                <span>Grand Total</span>
                <AmountDisplay amount={bill.grandTotal ?? bill.totalAmount} className="text-2xl" />
              </div>
              <p className="mt-2 text-muted-foreground">Total Profit</p>
              <AmountDisplay amount={bill.totalProfit} className="text-lg" />
            </div>
          </div>
          {bill.notes && (
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-medium">Notes:</span> {bill.notes}
            </p>
          )}
          {bill.whatsappSent && bill.whatsappSentAt && (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
              WhatsApp sent on {format(new Date(bill.whatsappSentAt), 'PPp')}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="h-10 px-4 text-left font-medium">Product</th>
                  <th className="h-10 px-4 text-right font-medium">CTN</th>
                  <th className="h-10 px-4 text-right font-medium">PCS</th>
                  <th className="h-10 px-4 text-right font-medium">Rate/PCS</th>
                  <th className="h-10 px-4 text-right font-medium">Total</th>
                  <th className="h-10 px-4 text-right font-medium">Profit</th>
                  <th className="h-10 w-16 px-4" />
                </tr>
              </thead>
              <tbody>
                {bill.items.map((item) => {
                  const isExpanded = expandedRows.has(item._id)
                  return (
                    <React.Fragment key={item._id}>
                      <tr
                        className={cn(
                          'border-b cursor-pointer hover:bg-muted/50',
                          isExpanded && 'bg-muted/30'
                        )}
                        onClick={() => toggleRow(item._id)}
                      >
                        <td className="p-4 font-medium">
                          {(item.product as { productName?: string })?.productName ?? (item.indiaProduct as { productName?: string })?.productName ?? '—'}
                        </td>
                        <td className="p-4 text-right">{formatCtnPcs(item.ctnSold, item.pcsSold)}</td>
                        <td className="p-4 text-right">{item.pcsSold}</td>
                        <td className="p-4 text-right">₹{item.ratePerPcs.toLocaleString('en-IN')}</td>
                        <td className="p-4 text-right">
                          <AmountDisplay amount={item.totalAmount} />
                        </td>
                        <td className="p-4 text-right">
                          <AmountDisplay amount={item.totalProfit} />
                        </td>
                        <td className="p-4">
                          {item.fifoBreakdown?.length > 1 && (
                            <span className="text-muted-foreground">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && item.fifoBreakdown?.length ? (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={7} className="p-4">
                            <div className="text-xs space-y-2">
                              {item.fifoNote && (
                                <p className="text-muted-foreground italic">{item.fifoNote}</p>
                              )}
                              <table className="w-full max-w-md">
                                <thead>
                                  <tr>
                                    <th className="text-left py-1">Batch Date</th>
                                    <th className="text-right py-1">CTN</th>
                                    <th className="text-right py-1">PCS</th>
                                    <th className="text-right py-1">Cost</th>
                                    <th className="text-right py-1">Profit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.fifoBreakdown.map((f: FifoItem, i: number) => (
                                    <tr key={i}>
                                      <td className="py-1">
                                        {f.buyingEntry?.entryDate
                                          ? format(new Date(f.buyingEntry.entryDate), 'dd/MM/yyyy')
                                          : '—'}
                                      </td>
                                      <td className="text-right py-1">{f.ctnConsumed}</td>
                                      <td className="text-right py-1">{f.pcsConsumed}</td>
                                      <td className="text-right py-1">₹{f.finalCost.toFixed(2)}</td>
                                      <td className="text-right py-1">
                                        <AmountDisplay amount={f.profit} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={downloadModalOpen} onOpenChange={setDownloadModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PDF Downloaded</DialogTitle>
            <DialogDescription>
              The Bill PDF has been successfully downloaded. Copy the customer's mobile number below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 my-2">
            <div className="flex-1 bg-muted px-4 py-2 rounded-md font-medium text-base border">
              {mobile === '—' ? 'No mobile number added' : mobile}
            </div>
            {mobile !== '—' && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(mobile)
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
