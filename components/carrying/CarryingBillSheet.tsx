'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createBill,
  createProduct,
  recalcProduct,
  type CarryingBill,
  type CarryingProduct,
} from '@/lib/carrying-types'

export interface CarryingBillSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bill: CarryingBill | null
  mode: 'create' | 'edit' | 'view'
  onSave: (bill: CarryingBill) => void
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function CarryingBillSheet({
  open,
  onOpenChange,
  bill,
  mode,
  onSave,
}: CarryingBillSheetProps) {
  const [containerName, setContainerName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [products, setProducts] = useState<CarryingProduct[]>([])
  const [touched, setTouched] = useState(false)

  const isView = mode === 'view'
  const isCreate = mode === 'create'

  const seedForm = useCallback(() => {
    if (bill) {
      setContainerName(bill.containerName)
      setCompanyName(bill.companyName)
      setProducts(
        bill.products.length > 0
          ? bill.products.map((p) => recalcProduct({ ...p }))
          : [createProduct()]
      )
    } else {
      setContainerName('')
      setCompanyName('')
      setProducts([createProduct()])
    }
    setTouched(false)
  }, [bill])

  useEffect(() => {
    if (open) seedForm()
  }, [open, seedForm])

  const updateProduct = (id: string, updates: Partial<CarryingProduct>) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, ...updates }
        return recalcProduct(next)
      })
    )
    setTouched(true)
  }

  const addRow = () => {
    setProducts((prev) => {
      const last = prev[prev.length - 1]
      const defaults =
        last != null
          ? {
              priceBuyCBM: last.priceBuyCBM,
              priceSellCBM: last.priceSellCBM,
            }
          : undefined
      return [...prev, createProduct(defaults)]
    })
    setTouched(true)
  }

  const removeRow = (id: string) => {
    setProducts((prev) => {
      const next = prev.filter((p) => p.id !== id)
      return next.length > 0 ? next : [createProduct()]
    })
    setTouched(true)
  }

  const sumCBM = products.reduce((s, p) => s + p.totalCBM, 0)
  const sumAmount = products.reduce((s, p) => s + p.totalAmount, 0)
  const sumProfit = products.reduce((s, p) => s + p.totalProfit, 0)

  const valid =
    containerName.trim() !== '' &&
    companyName.trim() !== '' &&
    products.every((p) => p.productName.trim() !== '')

  const handleSave = () => {
    if (!valid) return
    const filtered = products.filter((p) => p.productName.trim() !== '')
    const billToSave: CarryingBill = bill
      ? {
          ...bill,
          containerName: containerName.trim(),
          companyName: companyName.trim(),
          products: filtered.length > 0 ? filtered : [createProduct()],
          updatedAt: new Date().toISOString(),
        }
      : createBill({
          containerName: containerName.trim(),
          companyName: companyName.trim(),
          products: filtered.length > 0 ? filtered : [createProduct()],
        })
    onSave(billToSave)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[70vw] max-w-[70vw] flex-col overflow-hidden p-0 sm:max-w-[70vw]"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {isView ? 'View Bill' : isCreate ? 'Add New Bill' : 'Edit Bill'}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="carrying-container">Container Name</Label>
              <Input
                id="carrying-container"
                value={containerName}
                onChange={(e) => {
                  setContainerName(e.target.value)
                  setTouched(true)
                }}
                placeholder="e.g. CONT-001"
                readOnly={isView}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="carrying-company">Company Name</Label>
              <Input
                id="carrying-company"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value)
                  setTouched(true)
                }}
                placeholder="Company name"
                readOnly={isView}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Products</Label>
              {!isView && (
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  Add row
                </Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[600px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="min-w-[140px]" />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col className="w-28" />
                  <col className="w-28" />
                  <col className="w-28" />
                  {!isView && <col className="w-12" />}
                </colgroup>
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">Product Name</th>
                    <th className="p-2 text-right font-medium">Total CBM</th>
                    <th className="p-2 text-right font-medium">Price (Buy/CBM)</th>
                    <th className="p-2 text-right font-medium">Price (Sell/CBM)</th>
                    <th className="p-2 text-right font-medium">Total Amount</th>
                    <th className="p-2 text-right font-medium">Total Profit</th>
                    {!isView && <th className="w-12 p-2" />}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="p-1 align-middle">
                        <Input
                          className="h-8 w-full min-w-0 border border-input bg-background px-2 text-sm focus-visible:ring-1"
                          value={p.productName}
                          onChange={(e) =>
                            updateProduct(p.id, { productName: e.target.value })
                          }
                          placeholder="Name"
                          readOnly={isView}
                        />
                      </td>
                      <td className="p-1 text-right align-middle">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-8 w-full min-w-0 border border-input bg-background px-2 text-right text-sm focus-visible:ring-1"
                          value={p.totalCBM || ''}
                          onChange={(e) =>
                            updateProduct(p.id, {
                              totalCBM: parseFloat(e.target.value) || 0,
                            })
                          }
                          readOnly={isView}
                        />
                      </td>
                      <td className="p-1 text-right align-middle">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="shrink-0 text-muted-foreground">₹</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 w-full min-w-0 border border-input bg-background px-2 text-right text-sm focus-visible:ring-1"
                            value={p.priceBuyCBM || ''}
                            onChange={(e) =>
                              updateProduct(p.id, {
                                priceBuyCBM: parseFloat(e.target.value) || 0,
                              })
                            }
                            readOnly={isView}
                          />
                        </div>
                      </td>
                      <td className="p-1 text-right align-middle">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="shrink-0 text-muted-foreground">₹</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 w-full min-w-0 border border-input bg-background px-2 text-right text-sm focus-visible:ring-1"
                            value={p.priceSellCBM || ''}
                            onChange={(e) =>
                              updateProduct(p.id, {
                                priceSellCBM: parseFloat(e.target.value) || 0,
                              })
                            }
                            readOnly={isView}
                          />
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums align-middle">
                        ₹{formatNum(p.totalAmount)}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums align-middle ${
                          p.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        ₹{formatNum(p.totalProfit)}
                      </td>
                      {!isView && (
                        <td className="p-1 align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                            onClick={() => removeRow(p.id)}
                          >
                            ×
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50 font-medium">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right tabular-nums">{formatNum(sumCBM)}</td>
                    <td colSpan={2} className="p-2" />
                    <td className="p-2 text-right tabular-nums">₹{formatNum(sumAmount)}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        sumProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      ₹{formatNum(sumProfit)}
                    </td>
                    {!isView && <td className="w-12 p-2" />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t px-6 py-4">
          {!isView && (
            <>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!valid}>
                Save Bill
              </Button>
            </>
          )}
          {isView && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
