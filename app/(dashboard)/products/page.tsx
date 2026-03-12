'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Package, LayoutGrid, List, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProductCard } from '@/components/products/ProductCard'
import { ProductFormDialog } from '@/components/products/ProductFormDialog'
import { apiGet, apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'

type ViewMode = 'card' | 'table'

interface ProductItem {
  _id: string
  productName: string
  productDescription?: string
  productImage?: string
  buyingEntriesCount: number
  totalCtn: number
  availableCtn: number
   chinaWarehouseCtn: number
   inTransitCtn: number
   soldCtn: number
   hasUnpaidEntries: boolean
   chinaWarehouseReceived: 'yes' | 'no'
}

interface IndiaProductItem {
  _id: string
  productName: string
  productDescription?: string
  productImage?: string
  buyingEntriesCount: number
  totalCtn: number
  availableCtn: number
}

export default function ProductsPage() {
  const [activeTab, setActiveTab] = useState<'china' | 'india'>('china')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('card')
  const [page, setPage] = useState(1)
  const [indiaPage, setIndiaPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [indiaLoading, setIndiaLoading] = useState(true)
  const [data, setData] = useState<{
    products: ProductItem[]
    counts: {
      all: number
      chinaFactory: number
      chinaWh: number
      inTransit: number
      inIndia: number
      fullySold: number
      unpaid: number
    }
    pagination: { page: number; limit: number; total: number; pages: number }
  } | null>(null)
  const [indiaData, setIndiaData] = useState<{
    products: IndiaProductItem[]
    pagination: { page: number; limit: number; total: number; pages: number }
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [indiaDialogOpen, setIndiaDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null)
  const [chinaFilter, setChinaFilter] = useState<
    | 'all'
    | 'chinaFactory'
    | 'chinaWh'
    | 'inTransit'
    | 'inIndia'
    | 'fullySold'
    | 'unpaid'
  >('all')

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search.trim()) params.set('search', search.trim())
    const result = await apiGet<{
      products: ProductItem[]
      counts: {
        all: number
        chinaFactory: number
        chinaWh: number
        inTransit: number
        inIndia: number
        fullySold: number
        unpaid: number
      }
      pagination: { page: number; limit: number; total: number; pages: number }
    }>(
      `/api/products?${params}`
    )
    setLoading(false)
    if (result.success) setData(result.data)
    else toast.error(result.message)
  }, [page, search])

  const fetchIndiaProducts = useCallback(async () => {
    setIndiaLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(indiaPage))
    params.set('limit', '20')
    if (search.trim()) params.set('search', search.trim())
    const result = await apiGet<{ products: IndiaProductItem[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
      `/api/india-products?${params}`
    )
    setIndiaLoading(false)
    if (result.success) setIndiaData(result.data)
    else toast.error(result.message)
  }, [indiaPage, search])

  useEffect(() => {
    if (activeTab === 'china') fetchProducts()
  }, [activeTab, fetchProducts])

  useEffect(() => {
    if (activeTab === 'india') fetchIndiaProducts()
  }, [activeTab, fetchIndiaProducts])

  async function handleCreateChina(values: { productName: string; productDescription?: string; productImage?: string }) {
    const result = await apiPost<{ _id: string }>('/api/products', values)
    if (!result.success) {
      toast.error(result.message)
      throw new Error(result.message)
    }
    toast.success('China product created')
    fetchProducts()
  }

  async function handleCreateIndia(values: { productName: string; productDescription?: string; productImage?: string }) {
    const result = await apiPost<{ _id: string }>('/api/india-products', values)
    if (!result.success) {
      toast.error(result.message)
      throw new Error(result.message)
    }
    toast.success('India product created')
    fetchIndiaProducts()
  }

  const currentData = activeTab === 'china' ? data : indiaData
  const currentLoading = activeTab === 'china' ? loading : indiaLoading
  const productLink = (id: string) => (activeTab === 'china' ? `/products/${id}` : `/products/india/${id}`)

  const filteredChinaProducts = data
    ? data.products.filter((p) => {
        switch (chinaFilter) {
          case 'chinaFactory':
            return p.chinaWarehouseReceived === 'no'
          case 'chinaWh':
            return p.chinaWarehouseReceived === 'yes' && p.chinaWarehouseCtn > 0
          case 'inTransit':
            return p.inTransitCtn > 0
          case 'inIndia':
            return p.availableCtn > 0
          case 'fullySold':
            return p.soldCtn > 0 && p.availableCtn === 0
          case 'unpaid':
            return p.hasUnpaidEntries
          case 'all':
          default:
            return true
        }
      })
    : []

  const chinaSummary = useMemo(() => {
    if (!filteredChinaProducts.length) {
      return {
        totalCtn: 0,
        chinaFactoryCtn: 0,
        chinaWhCtn: 0,
        inTransitCtn: 0,
        availableCtn: 0,
        soldCtn: 0,
        unpaidEntries: 0,
        totalProducts: 0,
      }
    }
    const totalCtn = filteredChinaProducts.reduce((s, p) => s + (p.totalCtn || 0), 0)
    const chinaFactoryCtn = filteredChinaProducts
      .filter((p) => p.chinaWarehouseReceived === 'no')
      .reduce((s, p) => s + (p.totalCtn || 0), 0)
    const chinaWhCtn = filteredChinaProducts
      .filter((p) => p.chinaWarehouseReceived === 'yes')
      .reduce((s, p) => s + (p.chinaWarehouseCtn || 0), 0)
    const inTransitCtn = filteredChinaProducts.reduce(
      (s, p) => s + (p.inTransitCtn || 0),
      0
    )
    const availableCtn = filteredChinaProducts.reduce(
      (s, p) => s + (p.availableCtn || 0),
      0
    )
    const soldCtn = filteredChinaProducts.reduce((s, p) => s + (p.soldCtn || 0), 0)
    const unpaidEntries = filteredChinaProducts.filter((p) => p.hasUnpaidEntries).length

    return {
      totalCtn,
      chinaFactoryCtn,
      chinaWhCtn,
      inTransitCtn,
      availableCtn,
      soldCtn,
      unpaidEntries,
      totalProducts: filteredChinaProducts.length,
    }
  }, [filteredChinaProducts])

  return (
    <div className="space-y-6">
      {/* <PageHeader
        title="Products"
        description="Manage China and India products and buying entries."
      /> */}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'china' | 'india')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="china">China Products</TabsTrigger>
            <TabsTrigger value="india">India Products</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {activeTab === 'china' ? (
              <Button onClick={() => { setEditingProduct(null); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Add China Product
              </Button>
            ) : (
              <Button onClick={() => setIndiaDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add India Product
              </Button>
            )}
            <div className="flex gap-1">
              <Button
                variant={view === 'card' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setView('card')}
                aria-label="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={view === 'table' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setView('table')}
                aria-label="Table view"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <TabsContent value="china" className="mt-4 space-y-4">
          {currentLoading ? (
            <TableSkeleton rows={8} columns={5} />
          ) : !data?.products.length ? (
            <EmptyState
              icon={Package}
              title="No China products yet"
              description="Add your first China product to track buying entries and stock."
            >
              <Button onClick={() => { setEditingProduct(null); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Add China Product
              </Button>
            </EmptyState>
          ) : view === 'card' ? (
            <>
              {data && (
                <div className="flex flex-wrap items-center gap-2 my-3">
                  {[
                    { id: 'all', label: 'All', icon: '', count: data.counts.all },
                    { id: 'chinaFactory', label: '🏭 China Factory', icon: '', count: data.counts.chinaFactory },
                    { id: 'chinaWh', label: '🟡 China WH', icon: '', count: data.counts.chinaWh },
                    { id: 'inTransit', label: '🔵 In Transit', icon: '', count: data.counts.inTransit },
                    { id: 'inIndia', label: '🟢 In India', icon: '', count: data.counts.inIndia },
                    { id: 'fullySold', label: '📦 Fully Sold', icon: '', count: data.counts.fullySold },
                    { id: 'unpaid', label: '🔴 Unpaid', icon: '', count: data.counts.unpaid },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setChinaFilter(f.id as typeof chinaFilter)}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        chinaFilter === f.id
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <span>{f.label}</span>
                      <span
                        className={`ml-1 inline-flex items-center rounded-full px-1.5 text-[10px] ${
                          chinaFilter === f.id ? 'bg-white/20' : 'bg-background/60'
                        }`}
                      >
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {filteredChinaProducts.length > 0 && (
                <div className="mb-3">
                  <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg border items-center">
                    <div className="flex items-center gap-1.5 bg-background border rounded-md px-3 py-1.5">
                      <span className="text-[11px] text-muted-foreground">Total</span>
                      <span className="text-sm font-bold">{chinaSummary.totalCtn}</span>
                      <span className="text-[11px] text-muted-foreground">CTN</span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-background border rounded-md px-3 py-1.5">
                      <span className="text-xs">🏭</span>
                      <span className="text-[11px] text-muted-foreground">Factory</span>
                      <span className="text-sm font-bold text-muted-foreground">
                        {chinaSummary.chinaFactoryCtn}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-md px-3 py-1.5 dark:bg-amber-900/20">
                      <span className="text-xs">🟡</span>
                      <span className="text-[11px] text-amber-600">China WH</span>
                      <span className="text-sm font-bold text-amber-700">
                        {chinaSummary.chinaWhCtn}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-md px-3 py-1.5 dark:bg-blue-900/20">
                      <span className="text-xs">🔵</span>
                      <span className="text-[11px] text-blue-600">Transit</span>
                      <span className="text-sm font-bold text-blue-700">
                        {chinaSummary.inTransitCtn}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-1.5 dark:bg-emerald-900/20">
                      <span className="text-xs">🟢</span>
                      <span className="text-[11px] text-emerald-600">Available</span>
                      <span className="text-sm font-bold text-emerald-700">
                        {chinaSummary.availableCtn}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-md px-3 py-1.5 dark:bg-red-900/20">
                      <span className="text-xs">🔴</span>
                      <span className="text-[11px] text-red-600">Sold</span>
                      <span className="text-sm font-bold text-red-600">
                        {chinaSummary.soldCtn}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-100 rounded-md px-3 py-1.5 dark:bg-purple-900/20">
                      <span className="text-xs">💰</span>
                      <span className="text-[11px] text-purple-600">Unpaid</span>
                      <span className="text-sm font-bold text-purple-600">
                        {chinaSummary.unpaidEntries}
                      </span>
                    </div>

                    <div className="ml-auto flex items-center text-[11px] text-muted-foreground">
                      {chinaSummary.chinaFactoryCtn} + {chinaSummary.chinaWhCtn} +{' '}
                      {chinaSummary.inTransitCtn} + {chinaSummary.availableCtn} + {chinaSummary.soldCtn} ={' '}
                      {chinaSummary.totalCtn}
                      {chinaSummary.chinaFactoryCtn +
                        chinaSummary.chinaWhCtn +
                        chinaSummary.inTransitCtn +
                        chinaSummary.availableCtn +
                        chinaSummary.soldCtn === chinaSummary.totalCtn
                        ? ' ✅'
                        : ' ⚠️'}
                    </div>

                    {chinaFilter !== 'all' && (
                      <div className="w-full flex justify-end text-[11px] text-muted-foreground mt-1">
                        Showing filtered results ({chinaSummary.totalProducts}{' '}
                        {chinaSummary.totalProducts === 1 ? 'product' : 'products'})
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredChinaProducts.map((p) => (
                  <ProductCard
                    key={p._id}
                    _id={p._id}
                    productName={p.productName}
                    productImage={p.productImage}
                    buyingEntriesCount={p.buyingEntriesCount}
                    totalCtn={p.totalCtn}
                    availableCtn={p.availableCtn}
                    chinaWarehouseCtn={p.chinaWarehouseCtn}
                    inTransitCtn={p.inTransitCtn}
                    soldCtn={p.soldCtn}
                    hasUnpaidEntries={p.hasUnpaidEntries}
                    chinaWarehouseReceived={p.chinaWarehouseReceived}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="w-full overflow-hidden rounded-md border">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium">Product Name</th>
                    <th className="h-10 px-4 text-right font-medium">Total CTN</th>
                    <th className="h-10 px-4 text-right font-medium text-amber-600">China WH</th>
                    <th className="h-10 px-4 text-right font-medium text-blue-600">In Transit</th>
                    <th className="h-10 px-4 text-right font-medium text-emerald-600">Available</th>
                    <th className="h-10 px-4 text-right font-medium text-red-500">Sold</th>
                    <th className="h-10 px-4 text-right font-medium">Entries</th>
                    <th className="h-10 px-4 text-left font-medium">Status</th>
                    <th className="h-10 w-24 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {filteredChinaProducts.map((p) => (
                    <tr key={p._id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4 font-medium">
                        <Link href={`/products/${p._id}`} className="hover:underline">
                          {p.productName}
                        </Link>
                      </td>
                      <td className="p-4 text-right">{p.totalCtn}</td>
                      <td className="p-4 text-right text-amber-600">{p.chinaWarehouseCtn}</td>
                      <td className="p-4 text-right text-blue-600">{p.inTransitCtn}</td>
                      <td
                        className={`p-4 text-right ${
                          p.availableCtn > 0 ? 'text-emerald-600' : 'text-muted-foreground'
                        }`}
                      >
                        {p.availableCtn}
                      </td>
                      <td
                        className={`p-4 text-right ${
                          p.soldCtn > 0 ? 'text-red-500' : 'text-muted-foreground'
                        }`}
                      >
                        {p.soldCtn}
                      </td>
                      <td className="p-4 text-right">{p.buyingEntriesCount}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {p.chinaWarehouseReceived === 'yes' && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              WH Received
                            </span>
                          )}
                          {p.inTransitCtn > 0 && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                              In Transit
                            </span>
                          )}
                          {p.chinaWarehouseCtn > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              China WH
                            </span>
                          )}
                          {p.hasUnpaidEntries && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Unpaid
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/products/${p._id}`}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
          {(data?.pagination?.pages ?? 0) > 1 && (
            <Pagination
              page={data!.pagination.page}
              totalPages={data!.pagination.pages}
              total={data!.pagination.total}
              pageSize={data!.pagination.limit}
              onPageChange={setPage}
            />
          )}
        </TabsContent>

        <TabsContent value="india" className="mt-4 space-y-4">
          {indiaLoading ? (
            <TableSkeleton rows={8} columns={5} />
          ) : !indiaData?.products.length ? (
            <EmptyState
              icon={Package}
              title="No India products yet"
              description="Add your first India product to track buying entries and stock."
            >
              <Button onClick={() => setIndiaDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add India Product
              </Button>
            </EmptyState>
          ) : view === 'card' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {indiaData.products.map((p) => (
                <ProductCard
                  key={p._id}
                  _id={p._id}
                  productName={p.productName}
                  productImage={p.productImage}
                  buyingEntriesCount={p.buyingEntriesCount}
                  totalCtn={p.totalCtn}
                  availableCtn={p.availableCtn}
                  detailHref={`/products/india/${p._id}`}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[400px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium">Product Name</th>
                    <th className="h-10 px-4 text-right font-medium">Total CTN</th>
                    <th className="h-10 px-4 text-right font-medium">Available CTN</th>
                    <th className="h-10 px-4 text-right font-medium">Entries</th>
                    <th className="h-10 w-24 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {indiaData.products.map((p) => (
                    <tr key={p._id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4 font-medium">
                        <Link href={`/products/india/${p._id}`} className="hover:underline">
                          {p.productName}
                        </Link>
                      </td>
                      <td className="p-4 text-right">{p.totalCtn}</td>
                      <td className="p-4 text-right">{p.availableCtn}</td>
                      <td className="p-4 text-right">{p.buyingEntriesCount}</td>
                      <td className="p-4">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/products/india/${p._id}`}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(indiaData?.pagination?.pages ?? 0) > 1 && (
            <Pagination
              page={indiaData!.pagination.page}
              totalPages={indiaData!.pagination.pages}
              total={indiaData!.pagination.total}
              pageSize={indiaData!.pagination.limit}
              onPageChange={setIndiaPage}
            />
          )}
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreateChina}
        initialValues={editingProduct}
        title="Add China Product"
        submitLabel="Create"
      />
      <ProductFormDialog
        open={indiaDialogOpen}
        onOpenChange={setIndiaDialogOpen}
        onSubmit={handleCreateIndia}
        initialValues={null}
        title="Add India Product"
        submitLabel="Create"
      />
    </div>
  )
}
