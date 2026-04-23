'use client'

import { useMemo, useState, useEffect } from 'react'
import { Lock, Unlock, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { apiPost } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { cn } from '@/lib/utils'

interface LockButtonProps {
  entryId: string
  isLocked: boolean
  canLock: boolean
  totalCtn?: number
  chinaWarehouseCtn?: number
  inTransitCtn?: number
  availableCtn?: number
  soldCtn?: number
  chinaWarehouseReceived?: 'yes' | 'no'
  avgRmbRate?: number | null
  carryingRate?: number | null
  totalExpenseINR?: number
  qty?: number
  finalCost?: number
  onSuccess: () => void
  size?: 'sm' | 'default' | 'lg'
}

export function LockButton({
  entryId,
  isLocked,
  canLock,
  totalCtn,
  chinaWarehouseCtn,
  inTransitCtn,
  availableCtn,
  soldCtn,
  chinaWarehouseReceived,
  avgRmbRate,
  carryingRate,
  totalExpenseINR,
  qty,
  finalCost,
  onSuccess,
  size = 'sm',
}: LockButtonProps) {
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [chinaCtn, setChinaCtn] = useState<number | undefined>(chinaWarehouseCtn)
  const [transitCtn, setTransitCtn] = useState<number | undefined>(inTransitCtn)

  // Sync from props when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      setChinaCtn(chinaWarehouseCtn)
      setTransitCtn(inTransitCtn)
    }
  }, [dialogOpen, chinaWarehouseCtn, inTransitCtn])

  const total = totalCtn ?? 0
  const chinaVal = chinaCtn ?? 0
  const transitVal = transitCtn ?? 0
  const sold = soldCtn ?? 0
  const maxDistributable = total - sold

  const distributionTotal = chinaVal + transitVal
  const isOverDistributed = distributionTotal > maxDistributable
  const rawAvailable = total - chinaVal - transitVal - sold
  const isUnderDistributed = rawAvailable < 0

  const computedAvailable = useMemo(
    () => parseFloat(Math.max(0, rawAvailable).toFixed(4)),
    [rawAvailable]
  )

  const validateDistribution = useMemo(() => {
    const errors: Record<string, string> = {}
    if (chinaVal < 0) errors.chinaWh = 'Cannot be negative'
    if (transitVal < 0) errors.inTransit = 'Cannot be negative'
    if (rawAvailable < 0) errors.available = 'Distribution exceeds total CTN'
    return errors
  }, [chinaVal, transitVal, rawAvailable])

  const distributionErrors = validateDistribution
  const hasDistributionErrors =
    Object.keys(distributionErrors).length > 0 ||
    isOverDistributed ||
    isUnderDistributed

  const distributionError =
    isOverDistributed
      ? `Total exceeds ${maxDistributable} CTN available (${total} total - ${sold} sold). Reduce China WH or In Transit CTN.`
      : null

  const finalCostPerPiece = finalCost ?? 0
  const qtyPerCtn = qty ?? 0

  const displayAvailableCtn = computedAvailable
  const displaySoldCtn = useMemo(
    () => parseFloat((sold ?? 0).toFixed(4)),
    [sold]
  )
  const displayLockedCtn = useMemo(
    () => parseFloat((displayAvailableCtn + displaySoldCtn).toFixed(4)),
    [displayAvailableCtn, displaySoldCtn]
  )

  // lockedCtn = available + sold (lock full amount for both)
  const lockAmount = useMemo(
    () =>
      parseFloat(
        (finalCostPerPiece * qtyPerCtn * displayLockedCtn).toFixed(2)
      ),
    [finalCostPerPiece, qtyPerCtn, displayLockedCtn]
  )

  const isFullySold = total > 0 && sold >= total

  const lockEnabled =
    !isLocked &&
    canLock &&
    (avgRmbRate ?? 0) > 0 &&
    (carryingRate ?? 0) > 0

  const lockTooltip = useMemo(() => {
    if (isLocked) return 'Entry is locked — click unlock to edit'
    if ((totalCtn ?? 0) <= 0) return 'Entry has no CTN'
    if (chinaWarehouseReceived !== 'yes') return 'Set China Warehouse Received to Yes first'
    if ((avgRmbRate ?? 0) <= 0) return 'Set Avg RMB Rate first'
    if ((carryingRate ?? 0) <= 0) return 'Set Carrying Rate first'
    if (isFullySold) return 'Re-lock entry with updated cost'
    return 'Lock entry to confirm cost'
  }, [isLocked, totalCtn, chinaWarehouseReceived, avgRmbRate, carryingRate, isFullySold])

  async function handleClick() {
    if (!isLocked) {
      setDialogOpen(true)
      return
    }
    setLoading(true)
    const path = isLocked ? `/api/buying-entries/${entryId}/unlock` : `/api/buying-entries/${entryId}/lock`
    const result = await apiPost(path, {})
    setLoading(false)
    if (result.success) {
      toast.success(isLocked ? 'Entry unlocked' : 'Entry locked')
      onSuccess()
    } else toast.error(result.message)
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={(!isLocked && !lockEnabled) || loading}
        onClick={handleClick}
        title={lockTooltip}
      >
        {isLocked ? (
          <Lock className="h-4 w-4 text-emerald-600" />
        ) : (
          <Unlock className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="sr-only">{isLocked ? 'Unlock' : 'Lock'}</span>
      </Button>

      {!isLocked && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{isFullySold ? 'Re-lock Entry' : 'Lock Entry'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {!isFullySold && (
                <div className="rounded-lg border p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Warehouse Distribution
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="lock-china-ctn" className="text-xs">
                        China Warehouse CTN
                      </Label>
                      <Input
                        id="lock-china-ctn"
                        type="text"
                        inputMode="decimal"
                        value={chinaCtn === undefined || chinaCtn === null ? '' : chinaCtn}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') {
                            setChinaCtn(undefined)
                            return
                          }
                          const n = Number(v)
                          if (!Number.isNaN(n)) setChinaCtn(n)
                        }}
                        className={cn(
                          (distributionErrors.chinaWh || isOverDistributed) && 'border-red-500'
                        )}
                        placeholder="CTN in China"
                      />
                      {distributionErrors.chinaWh && (
                        <p className="text-xs text-red-500 mt-1">
                          {distributionErrors.chinaWh}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="lock-transit-ctn" className="text-xs">
                        In Transit CTN
                      </Label>
                      <Input
                        id="lock-transit-ctn"
                        type="text"
                        inputMode="decimal"
                        value={transitCtn === undefined || transitCtn === null ? '' : transitCtn}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') {
                            setTransitCtn(undefined)
                            return
                          }
                          const n = Number(v)
                          if (!Number.isNaN(n)) setTransitCtn(n)
                        }}
                        className={cn(
                          (distributionErrors.inTransit || isOverDistributed) && 'border-red-500'
                        )}
                        placeholder="CTN in transit"
                      />
                      {distributionErrors.inTransit && (
                        <p className="text-xs text-red-500 mt-1">
                          {distributionErrors.inTransit}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Available CTN (India)</Label>
                      <Input
                        value={
                          rawAvailable < 0
                            ? parseFloat(rawAvailable.toFixed(4))
                            : displayAvailableCtn
                        }
                        disabled
                        readOnly
                        className={cn(
                          computedAvailable > 0 &&
                            'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400',
                          computedAvailable === 0 && 'bg-muted',
                          rawAvailable < 0 &&
                            'border-red-500 bg-red-50 text-red-600 dark:bg-red-950/30'
                        )}
                      />
                      {distributionErrors.available && (
                        <p className="text-xs text-red-500 mt-1">
                          {distributionErrors.available}
                        </p>
                      )}
                    </div>
                  </div>

                  {distributionError && (
                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      ⚠️ {distributionError}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground mt-1">
                    {total} total − {sold} sold = {maxDistributable} to distribute
                  </p>

                  <div
                    className={cn(
                      'text-xs px-2 py-1 rounded',
                      hasDistributionErrors
                        ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                        : 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                    )}
                  >
                    {chinaVal} (China WH) + {transitVal} (Transit) +{' '}
                    {rawAvailable < 0
                      ? parseFloat(rawAvailable.toFixed(4))
                      : displayAvailableCtn}{' '}
                    (Available) + {sold} (Sold) = {total} CTN
                    {hasDistributionErrors ? ' ⚠️' : ` ✅`}
                  </div>

                  {sold > 0 && (
                    <p className="text-xs text-muted-foreground">
                      ℹ️ {sold} CTN already sold — fixed, cannot be changed
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Costing Summary
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg RMB Rate</span>
                    <span className="font-medium">
                      {avgRmbRate != null ? avgRmbRate : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Carrying Rate</span>
                    <span className="font-medium">
                      {carryingRate != null ? carryingRate : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Final Cost per piece</span>
                    <span className="font-medium">
                      <AmountDisplay amount={finalCostPerPiece} decimals={5} />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">QTY per CTN</span>
                    <span className="font-medium">{qtyPerCtn}</span>
                  </div>
                  <div className="border-t pt-2 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Available CTN (India)</span>
                      <span>{displayAvailableCtn} CTN</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Sold CTN</span>
                      <span>{displaySoldCtn} CTN</span>
                    </div>
                    <div className="flex justify-between font-medium text-sm border-t pt-1">
                      <span>Total Locked CTN</span>
                      <span>{displayLockedCtn} CTN</span>
                    </div>
                  </div>
                  <div className="flex justify-between font-semibold text-blue-600 dark:text-blue-400 border-t pt-2">
                    <span className="text-muted-foreground font-medium">
                      Lock Amount ({displayLockedCtn} × {qtyPerCtn} ×{' '}
                      <AmountDisplay amount={finalCostPerPiece} decimals={5} />)
                    </span>
                    <span>₹{lockAmount.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>

              {isFullySold ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:bg-blue-950/30 dark:border-blue-800">
                  <p className="font-medium">Re-locking entry with updated cost</p>
                  <p className="text-muted-foreground mt-1">
                    All {total} CTN already sold. Locking will save the new final cost.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    New Final Cost per piece:{' '}
                    <strong>
                      <AmountDisplay amount={finalCostPerPiece} decimals={5} />
                    </strong>
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                    Profit on existing sell bills will be recalculated automatically.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                  <p>
                    🔒 This will lock <strong>{displayLockedCtn} CTN</strong>
                  </p>
                  <p className="mt-1">
                    China Bank will be debited:{' '}
                    <strong>₹{lockAmount.toLocaleString('en-IN')}</strong>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ({displayLockedCtn} CTN × {qtyPerCtn} pcs ×{' '}
                    <AmountDisplay amount={finalCostPerPiece} decimals={5} />/pc)
                  </p>
                  {(soldCtn ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                      {displayAvailableCtn} available + {displaySoldCtn} sold = {displayLockedCtn} CTN
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    loading ||
                    displayLockedCtn <= 0 ||
                    (!isFullySold && hasDistributionErrors)
                  }
                  className={cn(
                    !isFullySold && hasDistributionErrors && 'opacity-50 cursor-not-allowed'
                  )}
                  onClick={async () => {
                    if (!isFullySold && (isOverDistributed || isUnderDistributed)) {
                      toast.error(
                        `Distribution exceeds available CTN. Max distributable: ${maxDistributable} CTN`
                      )
                      return
                    }
                    setLoading(true)
                    const result = await apiPost(`/api/buying-entries/${entryId}/lock`, {
                      chinaWarehouseCtn: chinaVal,
                      inTransitCtn: transitVal,
                    })
                    setLoading(false)
                    if (result.success) {
                      toast.success(isFullySold ? 'Entry re-locked. Profits recalculated.' : 'Entry locked successfully')
                      setDialogOpen(false)
                      onSuccess()
                    } else {
                      toast.error(result.message)
                    }
                  }}
                >
                  {isFullySold ? 'Re-lock with New Cost' : 'Lock Entry'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
