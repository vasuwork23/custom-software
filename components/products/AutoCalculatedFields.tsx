'use client'

import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { round, roundQty } from '@/lib/round'

function deriveStatus(
  totalAmount: number,
  givenAmount: number,
  remainingAmount: number
): 'paid' | 'unpaid' | 'partiallypaid' {
  if (totalAmount === 0) return 'unpaid'
  if (remainingAmount <= 0) return 'paid'
  if (givenAmount === 0) return 'unpaid'
  return 'partiallypaid'
}

export interface AutoCalculatedFieldsProps {
  totalCtn?: number
  qty?: number
  rate?: number
  cbm?: number
  weight?: number
  /** Given amount (RMB) — read-only: advance + payments */
  givenAmountDisplay: number
  hasAdvancePayment?: boolean
  advanceAmount?: number
  carryingRate?: number
  avgRmbRate?: number
}

export function AutoCalculatedFields({
  totalCtn,
  qty,
  rate,
  cbm,
  weight,
  givenAmountDisplay,
  hasAdvancePayment,
  advanceAmount,
  carryingRate,
  avgRmbRate,
}: AutoCalculatedFieldsProps) {
  const _totalCtn = totalCtn ?? 0
  const _qty = qty ?? 0
  const _rate = rate ?? 0
  const _cbm = cbm ?? 0
  const _weight = weight ?? 0

  // Raw values (mirror model logic, no early rounding)
  const totalQtyRaw = _totalCtn * _qty
  const totalCbmRaw = _totalCtn * _cbm
  const totalWeightRaw = _totalCtn * _weight
  const totalAmountRaw = totalQtyRaw * _rate
  const rmbInrPurchaseRaw = totalAmountRaw * (avgRmbRate ?? 0)
  const totalCarryingRaw = totalCbmRaw * (carryingRate ?? 0)
  const totalExpenseRaw = rmbInrPurchaseRaw + totalCarryingRaw

  const totalQty = roundQty(totalQtyRaw)
  const totalCbm = round(totalCbmRaw)
  const totalWeight = round(totalWeightRaw)
  const totalAmount = round(totalAmountRaw)
  const rmbInrPurchase = round(rmbInrPurchaseRaw)
  const totalCarrying = round(totalCarryingRaw)
  const totalExpenseINR = round(totalExpenseRaw)
  const remainingAmount = round(totalAmountRaw - givenAmountDisplay)

  const shippingCostPerPiece =
    totalQty > 0 ? round(totalCarryingRaw / totalQty) : 0
  const finalCost =
    totalQty > 0 ? round(totalExpenseRaw / totalQty) : 0 // per piece INR
  const status = deriveStatus(totalAmount, givenAmountDisplay, remainingAmount)

  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="text-sm font-semibold text-muted-foreground mb-3">
        Auto-calculated
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        {/* Row 1 */}
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total Qty</span>
          <span className="font-semibold text-sm">{totalQty}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total CBM</span>
          <span className="font-semibold text-sm">{totalCbm}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total Weight</span>
          <span className="font-semibold text-sm">{totalWeight}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total Amount</span>
          <span className="font-semibold text-sm">
            <AmountDisplay amount={totalAmount} currency="RMB" />
          </span>
        </div>

        {/* Row 2 */}
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">RMB→INR Value</span>
          <span className="font-semibold text-sm">
            <AmountDisplay amount={rmbInrPurchase} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total Carrying</span>
          <span className="font-semibold text-sm">
            <AmountDisplay amount={totalCarrying} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Shipping Cost/piece</span>
          <span className="font-semibold text-sm text-orange-600">
            <AmountDisplay amount={shippingCostPerPiece} decimals={5} />
          </span>
          <span className="text-xs text-muted-foreground/80">carrying ÷ total qty</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Total Expense INR</span>
          <span className="font-semibold text-sm text-blue-600">
            <AmountDisplay amount={totalExpenseINR} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Final Cost per piece</span>
          <span className="font-semibold text-sm text-emerald-600">
            <AmountDisplay amount={finalCost} decimals={5} />
          </span>
        </div>

        {/* Row 3 */}
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Given Amount</span>
          <span className="font-semibold text-sm">
            <AmountDisplay amount={givenAmountDisplay} currency="RMB" />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Remaining Amount</span>
          <span className="font-semibold text-sm text-red-500">
            <AmountDisplay amount={remainingAmount} currency="RMB" />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Status</span>
          <span className="mt-0.5">
            <StatusBadge status={status} />
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Advance Amount</span>
          <span className="font-semibold text-sm">
            <AmountDisplay amount={hasAdvancePayment ? advanceAmount ?? 0 : 0} currency="RMB" />
          </span>
        </div>
      </div>
    </div>
  )
}
