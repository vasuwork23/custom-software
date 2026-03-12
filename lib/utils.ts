import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateBillFileName(input: {
  companyName?: string | null
  billNumber: number
  billDate: string | Date
}): string {
  const rawName = (input.companyName ?? 'BILL').toUpperCase()
  const companyName =
    rawName
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9-]/g, '') || 'BILL'

  const date = format(new Date(input.billDate), 'dd-MM-yyyy')

  return `${companyName}_BILL-${input.billNumber}_${date}.pdf`
}

/** Format bill number for display as INV-YYYY-NNN. */
export function formatBillNumber(
  billNumber: number,
  billDate?: string | Date
): string {
  const baseDate =
    billDate != null ? new Date(billDate) : new Date()
  const year = baseDate.getFullYear()
  const padded = String(billNumber).padStart(3, '0')
  return `INV-${year}-${padded}`
}

/** Grand total = subtotal + extraCharges - discount. Use for all sell bill balance logic. */
export function calcGrandTotal(
  totalAmount: number,
  extraCharges: number = 0,
  discount: number = 0
): number {
  return parseFloat(Math.max(0, totalAmount + extraCharges - discount).toFixed(2))
}

export function generateOutstandingFileName(companyNameInput: string): string {
  const base = (companyNameInput || 'outstanding').trim()
  const companyName =
    base
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '') || 'outstanding'

  const date = format(new Date(), 'dd-MM-yyyy')

  return `${companyName}_outstanding_${date}.pdf`
}
