'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Package } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

interface ProductCardProps {
  _id: string
  productName: string
  productImage?: string | null
  buyingEntriesCount: number
  totalCtn: number
  availableCtn: number
  /** Defaults to /products/[id]. Use /products/india/[id] for India products. */
  detailHref?: string
  chinaFactoryCtn?: number
  chinaWarehouseCtn?: number
  inTransitCtn?: number
  soldCtn?: number
  hasUnpaidEntries?: boolean
  chinaWarehouseReceived?: 'yes' | 'no'
  hasWhReceived?: boolean
  hasNotReceived?: boolean
  totalCbm?: number
  totalWeight?: number
  /** Sum of remainingAmount (¥ RMB) across unpaid/partially paid entries */
  remainingAmount?: number
}

export function ProductCard({
  _id,
  productName,
  productImage,
  buyingEntriesCount,
  totalCtn,
  availableCtn,
  detailHref,
  chinaFactoryCtn,
  chinaWarehouseCtn,
  inTransitCtn,
  soldCtn,
  hasUnpaidEntries,
  chinaWarehouseReceived,
  hasWhReceived,
  hasNotReceived,
  totalCbm,
  totalWeight,
  remainingAmount,
}: ProductCardProps) {
  const href = detailHref ?? `/products/${_id}`
  return (
    <Link href={href}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
              {productImage ? (
                <Image
                  src={productImage}
                  alt={productName}
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{productName}</p>
              <p className="text-xs text-muted-foreground">
                {buyingEntriesCount} buying entries
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total CTN</span>
              <span className="font-semibold">{totalCtn} CTN</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Available</span>
              <span
                className={`font-semibold ${
                  availableCtn > 0 ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
              >
                {availableCtn} CTN
              </span>
            </div>
            {chinaWarehouseCtn != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">China WH</span>
                <span
                  className={`font-semibold ${
                    chinaWarehouseCtn > 0 ? 'text-amber-600' : 'text-muted-foreground'
                  }`}
                >
                  {chinaWarehouseCtn} CTN
                </span>
              </div>
            )}
            {inTransitCtn != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">In Transit</span>
                <span
                  className={`font-semibold ${
                    inTransitCtn > 0 ? 'text-blue-600' : 'text-muted-foreground'
                  }`}
                >
                  {inTransitCtn} CTN
                </span>
              </div>
            )}
            {soldCtn != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sold</span>
                <span
                  className={`font-semibold ${
                    soldCtn > 0 ? 'text-red-500' : 'text-muted-foreground'
                  }`}
                >
                  {soldCtn} CTN
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Entries</span>
              <span className="font-semibold">{buyingEntriesCount}</span>
            </div>
            {chinaFactoryCtn != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">🏭 Factory</span>
                <span className="font-semibold">{chinaFactoryCtn} CTN</span>
              </div>
            )}
            {totalCbm != null && (
              <div className="flex items-center justify-between col-span-2">
                <span className="text-muted-foreground">📦 Total CBM</span>
                <span className="font-semibold">
                  {(totalCbm ?? 0).toLocaleString('en-IN', {
                    maximumFractionDigits: 4,
                  })}
                </span>
              </div>
            )}
            {totalWeight != null && (
              <div className="flex items-center justify-between col-span-2">
                <span className="text-muted-foreground">⚖️ Total Weight</span>
                <span className="font-semibold">
                  {(totalWeight ?? 0).toFixed(2)} kg
                </span>
              </div>
            )}
            {remainingAmount != null && remainingAmount > 0 && (
              <div className="flex items-center justify-between col-span-2">
                <span className="text-muted-foreground">Remaining to pay</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  ¥{(remainingAmount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {(hasNotReceived || chinaWarehouseReceived === 'no') && totalCtn > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
                🏭 China Factory
              </span>
            )}
            {(hasWhReceived || chinaWarehouseCtn != null) &&
              chinaWarehouseCtn != null &&
              chinaWarehouseCtn > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  🟡 China WH
                </span>
              )}
            {inTransitCtn != null && inTransitCtn > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                🔵 In Transit
              </span>
            )}
            {hasUnpaidEntries && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                🔴 Unpaid
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
