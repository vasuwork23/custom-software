'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { format } from 'date-fns'
import { Package, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { IndiaBuyingEntryTable } from '@/components/products/IndiaBuyingEntryTable'
import { IndiaBuyingEntryForm } from '@/components/products/IndiaBuyingEntryForm'
import { MakeIndiaPaymentDialog } from '@/components/products/MakeIndiaPaymentDialog'
import { ProductFormDialog } from '@/components/products/ProductFormDialog'
import { apiGet, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { IndiaBuyingEntryRow } from '@/components/products/IndiaBuyingEntryTable'
import { cn } from '@/lib/utils'

interface SellingHistoryRow {
  _id: string
  sellBillId: string
  billNumber: number
  billDate: string
  companyId?: string
  companyName: string
  ctnSold: number
  pcsSold: number
  ratePerPcs: number
  totalAmount: number
  totalProfit: number
  fifoNote?: string
}

interface IndiaProductDetail {
  _id: string
  productName: string
  productDescription?: string
  productImage?: string
  buyingEntriesCount: number
  totalCtn: number
  availableCtn: number
  totalSoldCtn: number
  totalInvested: number
  totalProfit: number
  sellingHistory: SellingHistoryRow[]
}

export default function IndiaProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [product, setProduct] = useState<IndiaProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editProductOpen, setEditProductOpen] = useState(false)
  const [entrySheetOpen, setEntrySheetOpen] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<IndiaBuyingEntryRow | null>(null)

  const fetchProduct = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<IndiaProductDetail>(`/api/india-products/${id}`)
    setLoading(false)
    if (result.success) setProduct(result.data)
    else {
      toast.error(result.message)
      router.push('/products')
    }
  }, [id, router])

  useEffect(() => {
    fetchProduct()
  }, [fetchProduct])

  async function handleUpdateProduct(values: { productName: string; productDescription?: string; productImage?: string }) {
    const result = await apiPut(`/api/india-products/${id}`, values)
    if (!result.success) {
      toast.error(result.message)
      throw new Error(result.message)
    }
    toast.success('Product updated')
    fetchProduct()
  }

  async function handleDeleteProduct() {
    const result = await apiDelete(`/api/india-products/${id}`)
    if (!result.success) {
      toast.error(result.message ?? result.error)
      return
    }
    toast.success('Product deleted')
    router.push('/products')
  }

  function openAddEntry() {
    setEditingEntry(null)
    setEntrySheetOpen(true)
  }

  function openEditEntry(entry: IndiaBuyingEntryRow) {
    setEditingEntry(entry)
    setEntrySheetOpen(true)
  }

  if (loading || !product) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.productName}
        description={product.productDescription ?? undefined}
        breadcrumb={
          <Link href="/products" className="text-muted-foreground hover:text-foreground">
            Products
          </Link>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditProductOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <ConfirmDialog
              title="Delete India product"
              description="This will only work if there are no buying entries. Delete all buying entries first if needed."
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={handleDeleteProduct}
              trigger={<Button variant="destructive">Delete</Button>}
            />
          </div>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted">
          {product.productImage ? (
            <Image
              src={product.productImage}
              alt={product.productName}
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total CTN Bought</p>
              <p className="text-2xl font-semibold">{product.totalCtn}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Available CTN</p>
              <p className="text-2xl font-semibold">{product.availableCtn}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total Sold CTN</p>
              <p className="text-2xl font-semibold">{product.totalSoldCtn}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total Invested</p>
              <p className="text-2xl font-semibold">
                <AmountDisplay amount={product.totalInvested} />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total Profit</p>
              <p className={cn('text-2xl font-semibold', product.totalProfit < 0 && 'text-destructive')}>
                <AmountDisplay amount={product.totalProfit} />
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="buying">
        <TabsList>
          <TabsTrigger value="buying">Buying History</TabsTrigger>
          <TabsTrigger value="selling">Selling History</TabsTrigger>
        </TabsList>
        <TabsContent value="buying" className="mt-4">
          <IndiaBuyingEntryTable
            productId={id}
            onRefresh={fetchProduct}
            onEdit={openEditEntry}
            onAdd={openAddEntry}
            onMakePayment={() => setPaymentDialogOpen(true)}
          />
        </TabsContent>
        <TabsContent value="selling" className="mt-4">
          {!product.sellingHistory?.length ? (
            <div className="rounded-md border py-12 text-center text-muted-foreground">No sales yet for this product.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Bill No</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Company Name</th>
                    <th className="text-right p-3 font-medium">CTN Sold</th>
                    <th className="text-right p-3 font-medium">PCS Sold</th>
                    <th className="text-right p-3 font-medium">Rate per PCS (₹)</th>
                    <th className="text-right p-3 font-medium">Total Amount (₹)</th>
                    <th className="text-right p-3 font-medium">Profit (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {product.sellingHistory.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="p-3">
                        <Link href={`/sale-bills/${row.sellBillId}`} className="text-primary hover:underline font-medium">
                          {row.billNumber}
                        </Link>
                      </td>
                      <td className="p-3">{format(new Date(row.billDate), 'dd MMM yyyy')}</td>
                      <td className="p-3">
                        {row.companyId ? (
                          <Link href={`/companies/${row.companyId}`} className="text-primary hover:underline">
                            {row.companyName}
                          </Link>
                        ) : (
                          row.companyName
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">{row.ctnSold}</td>
                      <td className="p-3 text-right tabular-nums">{row.pcsSold}</td>
                      <td className="p-3 text-right">
                        <AmountDisplay amount={row.ratePerPcs} />
                      </td>
                      <td className="p-3 text-right">
                        <AmountDisplay amount={row.totalAmount} />
                      </td>
                      <td className="p-3 text-right">
                        <span className={cn('font-medium tabular-nums', row.totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
                          <AmountDisplay amount={row.totalProfit} showSign />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <MakeIndiaPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        productId={id}
        productName={product.productName}
        onSuccess={fetchProduct}
      />
      <IndiaBuyingEntryForm
        open={entrySheetOpen}
        onOpenChange={setEntrySheetOpen}
        productId={id}
        productName={product.productName}
        onSuccess={fetchProduct}
        editEntry={
          editingEntry
            ? {
                _id: editingEntry._id,
                entryDate: editingEntry.entryDate,
                totalCtn: editingEntry.totalCtn,
                availableCtn: editingEntry.availableCtn,
                qty: editingEntry.qty,
                rate: editingEntry.rate,
                givenAmount: editingEntry.givenAmount,
                hasAdvancePayment: editingEntry.hasAdvancePayment,
                advanceAmount: editingEntry.advanceAmount,
                advanceBankAccount: editingEntry.advanceBankAccount,
                advanceDate: editingEntry.advanceDate,
                advanceNote: editingEntry.advanceNote,
              }
            : null
        }
      />

      <ProductFormDialog
        open={editProductOpen}
        onOpenChange={setEditProductOpen}
        onSubmit={handleUpdateProduct}
        initialValues={{
          productName: product.productName,
          productDescription: product.productDescription ?? '',
          productImage: product.productImage ?? '',
        }}
        title="Edit India Product"
        submitLabel="Update"
      />
    </div>
  )
}
