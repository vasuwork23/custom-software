/**
 * Isolated Carrying module — localStorage persistence.
 * No dependencies on other app modules.
 */

import type { CarryingBill } from './carrying-types'

const STORAGE_KEY = 'carrying_bills'

export function getCarryingBills(): CarryingBill[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CarryingBill[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCarryingBills(bills: CarryingBill[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bills))
  } catch {
    // ignore
  }
}

export function getCarryingBillById(id: string): CarryingBill | null {
  const bills = getCarryingBills()
  return bills.find((b) => b.id === id) ?? null
}

export function saveCarryingBill(bill: CarryingBill): CarryingBill[] {
  const bills = getCarryingBills()
  const index = bills.findIndex((b) => b.id === bill.id)
  const updated = { ...bill, updatedAt: new Date().toISOString() }
  const next =
    index >= 0
      ? bills.map((b, i) => (i === index ? updated : b))
      : [...bills, { ...updated, createdAt: updated.createdAt ?? new Date().toISOString() }]
  saveCarryingBills(next)
  return next
}

export function deleteCarryingBill(id: string): CarryingBill[] {
  const bills = getCarryingBills().filter((b) => b.id !== id)
  saveCarryingBills(bills)
  return bills
}
