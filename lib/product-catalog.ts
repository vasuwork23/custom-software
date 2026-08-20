import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'

export interface SellableProduct {
  value: string // "china:<id>" | "india:<id>"
  label: string // display name with flag
  productName: string // raw name, used for matching
  source: 'china' | 'india'
  productId: string
  availableCtn: number
  availablePcs: number
  qtyPerCtn: number
}

/**
 * All in-stock products (China + India) with their stock totals and carton size.
 * Stock is computed via aggregation — no per-product N+1 queries.
 */
export async function getSellableProducts(search = ''): Promise<SellableProduct[]> {
  const nameFilter = search ? { productName: new RegExp(search, 'i') } : {}

  const [chinaStock, indiaStock, chinaProducts, indiaProducts] = await Promise.all([
    BuyingEntry.aggregate([
      { $match: { chinaWarehouseReceived: 'yes', isLocked: true, availableCtn: { $gt: 0 } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$product',
          availableCtn: { $sum: '$availableCtn' },
          availablePcs: { $sum: { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] } },
          qtyPerCtn: { $first: '$qty' },
        },
      },
    ]),
    IndiaBuyingEntry.aggregate([
      { $match: { availableCtn: { $gt: 0 } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$product',
          availableCtn: { $sum: '$availableCtn' },
          availablePcs: { $sum: { $round: [{ $multiply: ['$availableCtn', '$qty'] }, 0] } },
          qtyPerCtn: { $first: '$qty' },
        },
      },
    ]),
    Product.find(nameFilter).select('productName').sort({ productName: 1 }).lean(),
    IndiaProduct.find(nameFilter).select('productName').sort({ productName: 1 }).lean(),
  ])

  const chinaStockMap = new Map(chinaStock.map((s) => [String(s._id), s]))
  const indiaStockMap = new Map(indiaStock.map((s) => [String(s._id), s]))

  const products: SellableProduct[] = []

  for (const p of chinaProducts) {
    const stock = chinaStockMap.get(String(p._id))
    if (!stock) continue
    products.push({
      value: `china:${p._id}`,
      label: `${p.productName} 🇨🇳 China`,
      productName: p.productName,
      source: 'china',
      productId: String(p._id),
      availableCtn: stock.availableCtn,
      availablePcs: stock.availablePcs,
      qtyPerCtn: stock.qtyPerCtn ?? 0,
    })
  }

  for (const p of indiaProducts) {
    const stock = indiaStockMap.get(String(p._id))
    if (!stock) continue
    products.push({
      value: `india:${p._id}`,
      label: `${p.productName} 🇮🇳 India`,
      productName: p.productName,
      source: 'india',
      productId: String(p._id),
      availableCtn: stock.availableCtn,
      availablePcs: stock.availablePcs,
      qtyPerCtn: stock.qtyPerCtn ?? 0,
    })
  }

  return products
}

export interface ProductDiagnostic {
  productId: string
  source: 'china' | 'india'
  productName: string
  totalEntries: number
  availableCtn: number
  awaitingWarehouse: number
  unlocked: number
}

/**
 * Stock diagnostics for every product, including those excluded from
 * `getSellableProducts`. Used to explain *why* a name in a pasted message
 * could not be matched to sellable stock. Only loaded on demand.
 */
export async function getProductDiagnostics(): Promise<ProductDiagnostic[]> {
  const [chinaProducts, indiaProducts, chinaAgg, indiaAgg] = await Promise.all([
    Product.find({}).select('productName').lean(),
    IndiaProduct.find({}).select('productName').lean(),
    BuyingEntry.aggregate([
      {
        $group: {
          _id: '$product',
          totalEntries: { $sum: 1 },
          availableCtn: { $sum: '$availableCtn' },
          awaitingWarehouse: {
            $sum: { $cond: [{ $ne: ['$chinaWarehouseReceived', 'yes'] }, 1, 0] },
          },
          unlocked: { $sum: { $cond: [{ $ne: ['$isLocked', true] }, 1, 0] } },
        },
      },
    ]),
    IndiaBuyingEntry.aggregate([
      { $group: { _id: '$product', totalEntries: { $sum: 1 }, availableCtn: { $sum: '$availableCtn' } } },
    ]),
  ])

  const chinaMap = new Map(chinaAgg.map((a) => [String(a._id), a]))
  const indiaMap = new Map(indiaAgg.map((a) => [String(a._id), a]))
  const out: ProductDiagnostic[] = []

  for (const p of chinaProducts) {
    const a = chinaMap.get(String(p._id))
    out.push({
      productId: String(p._id),
      source: 'china',
      productName: p.productName,
      totalEntries: a?.totalEntries ?? 0,
      availableCtn: a?.availableCtn ?? 0,
      awaitingWarehouse: a?.awaitingWarehouse ?? 0,
      unlocked: a?.unlocked ?? 0,
    })
  }
  for (const p of indiaProducts) {
    const a = indiaMap.get(String(p._id))
    out.push({
      productId: String(p._id),
      source: 'india',
      productName: p.productName,
      totalEntries: a?.totalEntries ?? 0,
      availableCtn: a?.availableCtn ?? 0,
      awaitingWarehouse: 0,
      unlocked: 0,
    })
  }
  return out
}

/** Plain-language reason a product cannot currently be sold. */
export function explainNoStock(d: ProductDiagnostic): string {
  if (d.totalEntries === 0) return 'it has no buying entries yet'
  if (d.source === 'china' && d.awaitingWarehouse === d.totalEntries) {
    return 'its China buying entry is not marked received at the warehouse yet'
  }
  if (d.source === 'china' && d.unlocked === d.totalEntries) {
    return 'its buying entry is not locked yet'
  }
  if (d.availableCtn <= 0) return 'it is sold out (0 CTN available)'
  return 'it has no sellable stock right now'
}
