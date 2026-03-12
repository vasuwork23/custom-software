'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { format } from 'date-fns'
import { Package, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BuyingEntryTable } from '@/components/products/BuyingEntryTable'
import { BuyingEntryForm } from '@/components/products/BuyingEntryForm'
import { MakePaymentDialog } from '@/components/products/MakePaymentDialog'
import { ProductFormDialog } from '@/components/products/ProductFormDialog'
import { apiGet, apiPut, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { BuyingEntryRow } from '@/components/products/BuyingEntryTable'
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
  fifoBreakdown: { buyingEntry: string; ctnConsumed: number; pcsConsumed: number; finalCost: number; profit: number }[]
  weightedFinalCost: number
  marginPercent: number
  fifoBreakdownCount: number
}

interface ProductDetail {
  _id: string
  productName: string
  productDescription?: string
  productImage?: string
  buyingEntriesCount: number
  totalCtn: number
  availableCtn: number
  totalSoldCtn: number
  chinaWhCtn: number
  inTransitCtn: number
  chinaFactoryCtn: number
  totalCbm?: number
  totalWeight?: number
  totalProfit: number
  sellingHistory: SellingHistoryRow[]
}

function StatCard({
  label,
  value,
  color = 'text-foreground',
  valueLength,
}: {
  label: string
  value: React.ReactNode
  color?: string
  valueLength?: number
}) {
  const len = valueLength ?? (typeof value === 'string' || typeof value === 'number' ? String(value).length : 8)
  const fontSizeClass = len > 10 ? 'text-sm' : len > 7 ? 'text-base' : 'text-xl'
  return (
    <div className="rounded-lg border bg-card p-3 min-w-0 overflow-hidden flex flex-col justify-between h-20">
      <p className="text-xs text-muted-foreground truncate leading-tight">
        {label}
      </p>
      <p className={cn('font-bold mt-auto truncate leading-tight', fontSizeClass, color)}>
        {value}
      </p>
    </div>
  )
}

export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editProductOpen, setEditProductOpen] = useState(false)
  const [entrySheetOpen, setEntrySheetOpen] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<BuyingEntryRow | null>(null)

  const fetchProduct = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const result = await apiGet<ProductDetail>(`/api/products/${id}`)
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
    const result = await apiPut(`/api/products/${id}`, values)
    if (!result.success) {
      toast.error(result.message)
      throw new Error(result.message)
    }
    toast.success('Product updated')
    fetchProduct()
  }

  async function handleDeleteProduct() {
    const result = await apiDelete(`/api/products/${id}`)
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

  function openEditEntry(entry: BuyingEntryRow) {
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
          <a href="/products" className="text-muted-foreground hover:text-foreground">
            Products
          </a>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditProductOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <ConfirmDialog
              title="Delete product"
              description="This will only work if there are no buying entries. Delete all buying entries first if needed."
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={handleDeleteProduct}
              trigger={<Button variant="destructive">Delete</Button>}
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-6">
        <div className="rounded-lg border bg-card p-3 min-w-0 overflow-hidden flex flex-col justify-center items-center h-20">
          {product.productImage ? (
            <Image
              src={product.productImage}
              alt={product.productName}
              width={64}
              height={64}
              className="h-14 w-14 object-cover rounded"
            />
          ) : (
            <Package className="h-10 w-10 text-muted-foreground shrink-0" />
          )}
        </div>
        <StatCard label="Total CTN Bought" value={product.totalCtn} />
        <StatCard label="🏭 China Factory CTN" value={product.chinaFactoryCtn} color="text-gray-600" />
        <StatCard label="🟡 China WH CTN" value={product.chinaWhCtn} color="text-amber-600" />
        <StatCard label="In Transit CTN" value={product.inTransitCtn} color="text-blue-600" />
        <StatCard
          label="Available CTN"
          value={product.availableCtn}
          color={product.availableCtn > 0 ? 'text-green-600' : 'text-muted-foreground'}
        />
        <StatCard
          label="Total Sold CTN"
          value={product.totalSoldCtn}
          color={product.totalSoldCtn > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
        />
        <StatCard
          label="Total Profit"
          value={<AmountDisplay amount={product.totalProfit} className={cn(product.totalProfit < 0 && 'text-destructive')} />}
          valueLength={Math.abs(product.totalProfit) >= 1_000_000 ? 12 : Math.abs(product.totalProfit) >= 100_000 ? 8 : 6}
          color={product.totalProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}
        />
        <StatCard
          label="All entry CBM"
          value={Math.round((product.totalCbm ?? 0) * 10000) / 10000}
        />
        <StatCard
          label="Total weight"
          value={Math.round((product.totalWeight ?? 0) * 10000) / 10000}
        />
        <StatCard label="Buying Entries" value={product.buyingEntriesCount} />
      </div>

      <Tabs defaultValue="buying">
        <TabsList>
          <TabsTrigger value="buying">Buying History</TabsTrigger>
          <TabsTrigger value="selling">Selling History</TabsTrigger>
        </TabsList>
        <TabsContent value="buying" className="mt-4">
          <div className="w-full overflow-hidden rounded-md border">
            <BuyingEntryTable
              productId={id}
              onRefresh={fetchProduct}
              onEdit={openEditEntry}
              onAdd={openAddEntry}
              onMakePayment={() => setPaymentDialogOpen(true)}
            />
          </div>
        </TabsContent>
        <TabsContent value="selling" className="mt-4">
          {!product.sellingHistory?.length ? (
            <div className="rounded-md border py-12 text-center text-muted-foreground">
              No sales yet for this product.
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-md border">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Bill No</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Company Name</th>
                    <th className="text-right p-3 font-medium">CTN Sold</th>
                    <th className="text-right p-3 font-medium">PCS Sold</th>
                    <th className="text-right p-3 font-medium">Final Cost (₹)</th>
                    <th className="text-right p-3 font-medium">Rate per PCS (₹)</th>
                    <th className="text-right p-3 font-medium">Total Amount (₹)</th>
                    <th className="text-right p-3 font-medium">Profit (₹)</th>
                    <th className="text-right p-3 font-medium">Margin %</th>
                    <th className="text-left p-3 font-medium max-w-[180px]">FIFO Note</th>
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
                        <span
                          title={
                            row.fifoBreakdownCount > 1
                              ? `Weighted avg across ${row.fifoBreakdownCount} batches`
                              : undefined
                          }
                        >
                          <AmountDisplay amount={row.weightedFinalCost} />
                        </span>
                      </td>
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
                      <td
                        className={cn(
                          'p-3 text-right tabular-nums',
                          row.marginPercent > 20
                            ? 'text-green-600'
                            : row.marginPercent >= 10
                            ? 'text-amber-500'
                            : 'text-red-600'
                        )}
                      >
                        {row.marginPercent.toFixed(1)}%
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[180px]" title={row.fifoNote}>
                        <span className="line-clamp-2">{row.fifoNote ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={editProductOpen}
        onOpenChange={setEditProductOpen}
        onSubmit={handleUpdateProduct}
        initialValues={{
          productName: product.productName,
          productDescription: product.productDescription ?? '',
          productImage: product.productImage ?? '',
        }}
        title="Edit Product"
        submitLabel="Update"
      />

      <MakePaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        productId={id}
        productName={product.productName}
        onSuccess={fetchProduct}
      />
      <BuyingEntryForm
        open={entrySheetOpen}
        onOpenChange={setEntrySheetOpen}
        productId={id}
        onSuccess={fetchProduct}
        editEntry={editingEntry ?? null}
      />
    </div>
  )
}
