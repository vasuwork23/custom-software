/**
 * Isolated Carrying module — types only.
 * No dependencies on other app modules.
 */

export interface CarryingProduct {
  id: string
  productName: string
  totalCBM: number
  priceBuyCBM: number
  priceSellCBM: number
  /** Auto-calculated: totalCBM × priceSellCBM */
  totalAmount: number
  /** Auto-calculated: totalAmount - (totalCBM × priceBuyCBM) */
  totalProfit: number
}

export interface CarryingBill {
  id: string
  containerName: string
  companyName: string
  products: CarryingProduct[]
  createdAt: string
  updatedAt: string
}

export function createProduct(overrides?: Partial<CarryingProduct>): CarryingProduct {
  const id = overrides?.id ?? `prod_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const totalCBM = overrides?.totalCBM ?? 0
  const priceBuyCBM = overrides?.priceBuyCBM ?? 0
  const priceSellCBM = overrides?.priceSellCBM ?? 0
  const totalAmount = totalCBM * priceSellCBM
  const totalProfit = totalAmount - totalCBM * priceBuyCBM
  return {
    id,
    productName: overrides?.productName ?? '',
    totalCBM,
    priceBuyCBM,
    priceSellCBM,
    ...overrides,
    totalAmount: overrides?.totalAmount ?? totalAmount,
    totalProfit: overrides?.totalProfit ?? totalProfit,
  }
}

export function recalcProduct(p: CarryingProduct): CarryingProduct {
  const totalAmount = p.totalCBM * p.priceSellCBM
  const totalProfit = totalAmount - p.totalCBM * p.priceBuyCBM
  return { ...p, totalAmount, totalProfit }
}

export function createBill(overrides?: Partial<CarryingBill>): CarryingBill {
  const id = overrides?.id ?? `bill_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const now = new Date().toISOString()
  return {
    containerName: overrides?.containerName ?? '',
    companyName: overrides?.companyName ?? '',
    products: overrides?.products ?? [],
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    ...overrides,
    id,
  }
}
