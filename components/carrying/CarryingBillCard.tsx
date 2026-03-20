'use client'

import { Eye, Pencil, Trash2, FileDown } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { CarryingBill } from '@/lib/carrying-types'
import { exportCarryingBillToPdf } from '@/lib/carrying-pdf'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export interface CarryingBillCardProps {
  bill: CarryingBill
  onView: (bill: CarryingBill) => void
  onEdit: (bill: CarryingBill) => void
  onDelete: (id: string) => void
}

export function CarryingBillCard({ bill, onView, onEdit, onDelete }: CarryingBillCardProps) {
  const totalCBM = bill.products.reduce((s, p) => s + p.totalCBM, 0)
  const totalAmount = bill.products.reduce((s, p) => s + p.totalAmount, 0)
  const totalProfit = bill.products.reduce((s, p) => s + p.totalProfit, 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">{bill.containerName}</p>
            <p className="text-sm text-muted-foreground">{bill.companyName}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onView(bill)}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(bill)}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => exportCarryingBillToPdf(bill)}
              title="Export PDF"
            >
              <FileDown className="h-4 w-4" />
            </Button>
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
              title="Delete bill?"
              description={`This will permanently delete the bill for ${bill.containerName} / ${bill.companyName}.`}
              confirmLabel="Delete"
              onConfirm={() => onDelete(bill.id)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total CBM</span>
          <span>{formatMoney(totalCBM)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Amount</span>
          <span>₹{formatMoney(totalAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Profit</span>
          <span className={totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
            ₹{formatMoney(totalProfit)}
          </span>
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          Updated: {formatDate(bill.updatedAt)}
        </p>
      </CardContent>
    </Card>
  )
}
