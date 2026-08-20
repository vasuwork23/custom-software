import mongoose from 'mongoose'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import Company from '@/models/Company'
import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import BankAccount from '@/models/BankAccount'
import { getNextBillNumber } from '@/models/Counter'
import { createCashTransaction } from '@/lib/cash-transaction-helper'
import { createBankSaleTransaction } from '@/lib/bank-sale-transaction-helper'
import { calcGrandTotal } from '@/lib/utils'
import { processFIFO } from '@/lib/fifo'
import { processIndiaFIFO } from '@/lib/india-fifo'

export interface SellBillItemInput {
  productSource: 'china' | 'india'
  productId: string
  pcs: number
  ratePerPcs: number
}

export interface CreateSellBillInput {
  companyId: string // ObjectId | 'cashbook' | 'bankaccount'
  bankAccountId?: string
  billDate: string
  items: SellBillItemInput[]
  notes?: string
  extraCharges?: number
  extraChargesNote?: string
  discount?: number
  discountNote?: string
}

export const formatCtnPcs = (ctn: number, pcs: number): string => {
  const isWhole = Number.isInteger(ctn)
  return isWhole ? `${ctn} CTN (${pcs} pcs)` : `${ctn.toFixed(2)} CTN (${pcs} pcs)`
}

const itemSchema = {
  productSource: (v: unknown) => v === 'china' || v === 'india',
  productId: (v: unknown) => v != null && typeof v === 'string' && mongoose.Types.ObjectId.isValid(v),
  pcs: (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0,
  ratePerPcs: (v: unknown) => typeof v === 'number' && v >= 0,
}

/** Returns an error message, or null when the payload is valid. */
export function validateSellBillInput(input: CreateSellBillInput): string | null {
  const { companyId, billDate, items } = input
  const isCashbook = companyId === 'cashbook'
  const isBankSale = companyId === 'bankaccount'

  if (!companyId) return 'Select company or Cashbook'
  if (isBankSale && !mongoose.Types.ObjectId.isValid(input.bankAccountId ?? '')) {
    return 'Select a bank account'
  }
  if (!isCashbook && !isBankSale && !mongoose.Types.ObjectId.isValid(companyId)) {
    return 'Valid company is required'
  }
  if (!billDate) return 'Bill date is required'
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.some(
      (i) =>
        !itemSchema.productSource(i?.productSource) ||
        !itemSchema.productId(i?.productId) ||
        !itemSchema.pcs(i?.pcs) ||
        !itemSchema.ratePerPcs(i?.ratePerPcs)
    )
  ) {
    return 'At least one valid line item (source, product, PCS > 0, rate) is required'
  }
  return null
}

/**
 * Creates a sell bill with its FIFO-costed items and the matching cash / bank /
 * outstanding side effect. Throws on insufficient stock — callers creating bills
 * in bulk should catch per bill so one failure doesn't discard the rest.
 */
export async function createSellBill(
  input: CreateSellBillInput,
  createdBy: mongoose.Types.ObjectId
) {
  const { companyId, billDate, items } = input
  const notes = input.notes
  const extraCharges = Number(input.extraCharges) || 0
  const extraChargesNote = input.extraChargesNote != null ? String(input.extraChargesNote).trim() : ''
  const discount = Number(input.discount) || 0
  const discountNote = input.discountNote != null ? String(input.discountNote).trim() : ''
  const bankAccountId = input.bankAccountId != null ? String(input.bankAccountId).trim() : ''

  const isCashbook = companyId === 'cashbook'
  const isBankSale = companyId === 'bankaccount'

  const bankAccDoc = isBankSale
    ? await BankAccount.findById(bankAccountId).lean<{ accountName?: string }>()
    : null

  const billNumber = await getNextBillNumber()

  const bill = await SellBill.create({
    billNumber,
    company: isCashbook || isBankSale ? null : new mongoose.Types.ObjectId(companyId),
    isCashbook: !!isCashbook,
    isBankSale: !!isBankSale,
    bankAccount: isBankSale ? new mongoose.Types.ObjectId(bankAccountId) : null,
    companyName: isCashbook ? 'Cashbook' : isBankSale ? (bankAccDoc?.accountName ?? 'Bank Account') : null,
    billDate: new Date(billDate),
    items: [],
    totalAmount: 0,
    extraCharges,
    extraChargesNote: extraChargesNote || undefined,
    discount,
    discountNote: discountNote || undefined,
    grandTotal: 0,
    notes: notes != null && String(notes).trim() !== '' ? String(notes).trim() : undefined,
    whatsappSent: false,
    createdBy,
    updatedBy: createdBy,
  })

  const chinaProductIds = Array.from(
    new Set(items.filter((i) => i.productSource !== 'india').map((i) => i.productId))
  )
  const indiaProductIds = Array.from(
    new Set(items.filter((i) => i.productSource === 'india').map((i) => i.productId))
  )
  const [chinaProducts, indiaProducts] = await Promise.all([
    chinaProductIds.length ? Product.find({ _id: { $in: chinaProductIds } }).select('productName').lean() : [],
    indiaProductIds.length ? IndiaProduct.find({ _id: { $in: indiaProductIds } }).select('productName').lean() : [],
  ])
  const productNameById = new Map<string, string>()
  for (const p of [...chinaProducts, ...indiaProducts]) productNameById.set(String(p._id), p.productName)

  const createdItems: mongoose.Types.ObjectId[] = []
  let totalAmount = 0
  const summaryLines: string[] = []

  for (const row of items) {
    const productId = new mongoose.Types.ObjectId(row.productId)
    const isIndia = row.productSource === 'india'
    const { fifoBreakdown, fifoNote, totalProfit, pcsSold } = isIndia
      ? await processIndiaFIFO(productId, row.pcs, row.ratePerPcs)
      : await processFIFO(productId, row.pcs, row.ratePerPcs)
    const ctnSold = fifoBreakdown.reduce((s, b) => s + b.ctnConsumed, 0)
    const lineTotal = pcsSold * row.ratePerPcs
    totalAmount += lineTotal

    const item = await SellBillItem.create({
      sellBill: bill._id,
      productSource: row.productSource,
      product: isIndia ? undefined : productId,
      indiaProduct: isIndia ? productId : undefined,
      ctnSold: parseFloat(ctnSold.toFixed(4)),
      pcsSold,
      ratePerPcs: row.ratePerPcs,
      totalAmount: lineTotal,
      fifoBreakdown,
      fifoNote,
      totalProfit,
      createdBy,
      updatedBy: createdBy,
    })
    createdItems.push(item._id as mongoose.Types.ObjectId)

    const productName = productNameById.get(row.productId) ?? '—'
    summaryLines.push(`${productName}: ${formatCtnPcs(ctnSold, pcsSold)} @₹${row.ratePerPcs}`)
  }

  const trimmedNotes = notes != null && String(notes).trim() !== '' ? String(notes).trim() : ''
  const productsSummary = [summaryLines.join('\n'), trimmedNotes ? `Note: ${trimmedNotes}` : '']
    .filter(Boolean)
    .join('\n')

  const subtotal = Math.round(totalAmount * 100) / 100
  const grandTotal = calcGrandTotal(subtotal, extraCharges, discount)
  await SellBill.findByIdAndUpdate(bill._id, {
    items: createdItems,
    totalAmount: subtotal,
    extraCharges,
    extraChargesNote: extraChargesNote || undefined,
    discount,
    discountNote: discountNote || undefined,
    grandTotal,
  })

  if (isCashbook) {
    await createCashTransaction({
      type: 'credit',
      amount: grandTotal,
      description: `Cashbook sale — Bill #${bill.billNumber}\n${productsSummary}`,
      date: new Date(billDate),
      category: 'cashbook_sale',
      referenceId: bill._id as mongoose.Types.ObjectId,
      referenceType: 'SellBill',
    })
  } else if (isBankSale) {
    await createBankSaleTransaction({
      bankAccountId: new mongoose.Types.ObjectId(bankAccountId),
      amount: grandTotal,
      description: `Bank sale — Bill #${bill.billNumber}${bankAccDoc ? ` (${bankAccDoc.accountName})` : ''}\n${productsSummary}`,
      date: new Date(billDate),
      referenceId: bill._id as mongoose.Types.ObjectId,
      createdBy,
    })
  } else {
    await Company.findByIdAndUpdate(companyId, { $inc: { outstanding: grandTotal } })
  }

  return { billId: bill._id as mongoose.Types.ObjectId, billNumber: bill.billNumber, grandTotal }
}
