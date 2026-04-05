/**
 * Send sale bill PDF via WhatsApp Business Cloud API.
 * Requires WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID in env.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import mongoose from 'mongoose'
import { BillTemplate } from '@/components/pdf/BillTemplate'
import { OutstandingTemplate } from '@/components/pdf/OutstandingTemplate'
import Company from '@/models/Company'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import { generateBillFileName, generateOutstandingFileName } from '@/lib/utils'

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const BASE_URL = 'https://graph.facebook.com/v21.0'
const WHATSAPP_SENDER_NAME = process.env.WHATSAPP_SENDER_NAME ?? process.env.COMPANY_NAME ?? ''
const WHATSAPP_SENDER_PHONE = process.env.WHATSAPP_SENDER_PHONE ?? process.env.COMPANY_PHONE ?? ''

function formatMobile(mobile: string): string {
  const cleaned = mobile.replace(/\D/g, '')
  if (cleaned.length === 10) return `91${cleaned}`
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned
  return cleaned
}

export interface BillDataForWhatsApp {
  _id: string
  billNumber: number
  billDate: string
  totalAmount: number
  company: {
    companyName?: string
    ownerName?: string
    contact1Mobile?: string
    contact2Mobile?: string
    address?: string
    city?: string
  }
  items: {
    product?: { productName?: string }
    indiaProduct?: { productName?: string }
    ctnSold: number
    pcsSold: number
    ratePerPcs: number
    totalAmount: number
  }[]
}

export async function sendBillOnWhatsApp(
  billData: BillDataForWhatsApp
): Promise<{ success: true } | { success: false; message: string }> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return {
      success: false,
      message: 'WhatsApp is not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
    }
  }

  const mobile =
    billData.company.contact1Mobile || billData.company.contact2Mobile
  if (!mobile || !mobile.trim()) {
    return {
      success: false,
      message: 'Company has no mobile number. Add a contact mobile to send WhatsApp.',
    }
  }

  const toNumber = formatMobile(mobile)
  if (toNumber.length < 12) {
    return { success: false, message: 'Invalid mobile number.' }
  }

  try {
    const doc = React.createElement(BillTemplate, {
      bill: {
        billNumber: billData.billNumber,
        billDate: billData.billDate,
        totalAmount: billData.totalAmount,
        company: billData.company,
        items: billData.items,
      },
      yourCompanyName: process.env.COMPANY_NAME ?? '',
      yourAddress: process.env.COMPANY_ADDRESS ?? '',
      yourPhone: process.env.COMPANY_PHONE ?? '',
    })
    const pdfBuffer = await renderToBuffer(doc as any)

    const filename = generateBillFileName({
      companyName: billData.company.companyName,
      billNumber: billData.billNumber,
      billDate: billData.billDate,
    })

    const formData = new FormData()
    formData.append('file', new Blob([pdfBuffer as any], { type: 'application/pdf' }), filename)

    const uploadRes = await fetch(`${BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` },
      body: formData,
    })
    const uploadJson = (await uploadRes.json()) as { id?: string; error?: { message?: string } }
    if (!uploadRes.ok || !uploadJson.id) {
      console.error('WhatsApp media upload error:', uploadJson)
      return {
        success: false,
        message: uploadJson.error?.message ?? 'Failed to upload PDF to WhatsApp.',
      }
    }

    const messageRes = await fetch(`${BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'document',
        document: {
          id: uploadJson.id,
          filename,
          caption: `Dear ${
            billData.company.companyName ?? 'Customer'
          }, please find your bill #${
            billData.billNumber
          } attached. Total: ₹${billData.totalAmount.toLocaleString('en-IN')}`,
        },
      }),
    })
    const messageJson = (await messageRes.json()) as { error?: { message?: string } }
    if (!messageRes.ok) {
      console.error('WhatsApp message error:', messageJson)
      return {
        success: false,
        message: messageJson.error?.message ?? 'Failed to send WhatsApp message.',
      }
    }

    return { success: true }
  } catch (err) {
    console.error('WhatsApp send error:', err)
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Failed to send bill on WhatsApp.',
    }
  }
}

export async function sendOutstandingReminder(
  companyId: string,
  customMessage?: string
): Promise<{ success: boolean; message: string }> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return {
      success: false,
      message:
        'WhatsApp is not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
    }
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    return { success: false, message: 'Invalid company id.' }
  }

  const id = new mongoose.Types.ObjectId(companyId)

  const company = await Company.findById(id).lean()
  if (!company) {
    return { success: false, message: 'Company not found.' }
  }

  const primaryMobile = (company as { primaryMobile?: string }).primaryMobile
  if (!primaryMobile || !primaryMobile.trim()) {
    return {
      success: false,
      message: 'No WhatsApp number found for this company',
    }
  }

  const toNumber = formatMobile(primaryMobile)
  if (toNumber.length < 12) {
    return { success: false, message: 'Invalid WhatsApp mobile number.' }
  }

  const [billedRes, receivedRes, bills] = await Promise.all([
    SellBill.aggregate([
      { $match: { company: id } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
    ]),
    PaymentReceipt.aggregate([
      { $match: { company: id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    SellBill.find({ company: id })
      .sort({ billDate: -1, createdAt: -1 })
      .limit(20)
      .select('billNumber billDate totalAmount grandTotal')
      .lean(),
  ])

  const totalBilled = billedRes[0]?.total ?? 0
  const totalReceived = receivedRes[0]?.total ?? 0
  const outstanding = totalBilled - totalReceived + ((company as any).openingBalance || 0)

  if (outstanding <= 0) {
    return {
      success: false,
      message: 'No outstanding amount for this company.',
    }
  }

  const formatter = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  })

  const lines: string[] = []
  const companyName = (company as { companyName?: string }).companyName ?? ''

  if (customMessage && customMessage.trim()) {
    lines.push(customMessage.trim())
  } else {
    lines.push(`Dear ${companyName || 'Customer'},`)
    lines.push('')
    lines.push('This is a reminder for your outstanding payment.')
    lines.push('')
    lines.push(
      `Outstanding Amount: ₹${formatter.format(outstanding)}`
    )
    if (bills.length) {
      lines.push('')
      lines.push('Bill wise breakdown:')
      for (const bill of bills) {
        const date =
          bill.billDate instanceof Date
            ? bill.billDate.toISOString().slice(0, 10)
            : new Date(bill.billDate).toISOString().slice(0, 10)
        const billAmount = (bill as { grandTotal?: number }).grandTotal ?? bill.totalAmount
        lines.push(
          `- INV-${bill.billNumber} dated ${date}: ₹${formatter.format(
            billAmount
          )}`
        )
      }
    }
    lines.push('')
    lines.push('Please clear the payment at your earliest convenience.')
    lines.push('')
    lines.push('Thank you,')
    lines.push(WHATSAPP_SENDER_NAME)
    if (WHATSAPP_SENDER_PHONE) {
      lines.push(WHATSAPP_SENDER_PHONE)
    }
  }

  const body = lines.join('\n')

  try {
    const messageRes = await fetch(
      `${BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNumber,
          type: 'text',
          text: { body },
        }),
      }
    )
    const messageJson = (await messageRes.json()) as {
      error?: { message?: string }
    }
    if (!messageRes.ok) {
      console.error('WhatsApp outstanding message error:', messageJson)
      return {
        success: false,
        message:
          messageJson.error?.message ?? 'Failed to send WhatsApp message.',
      }
    }

    await Company.findByIdAndUpdate(id, {
      lastWhatsappSentAt: new Date(),
      lastWhatsappMessage: body,
    })

    return {
      success: true,
      message: 'Outstanding reminder sent successfully.',
    }
  } catch (err) {
    console.error('WhatsApp outstanding send error:', err)
    return {
      success: false,
      message:
        err instanceof Error ? err.message : 'Failed to send outstanding reminder.',
    }
  }
}

export async function sendOutstandingOnWhatsApp(
  companyId: string,
  mobileNumber?: string
): Promise<{ success: boolean; message: string }> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return {
      success: false,
      message:
        'WhatsApp is not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
    }
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    return { success: false, message: 'Invalid company id.' }
  }

  const id = new mongoose.Types.ObjectId(companyId)

  const company = await Company.findById(id)
    .select(
      'companyName ownerName primaryMobile contact1Mobile contact2Mobile contact1Name openingBalance openingBalanceNotes'
    )
    .lean()
  if (!company) {
    return { success: false, message: 'Company not found.' }
  }

  const rawMobile =
    mobileNumber ||
    (company as { primaryMobile?: string }).primaryMobile ||
    (company as { contact1Mobile?: string }).contact1Mobile ||
    (company as { contact2Mobile?: string }).contact2Mobile

  if (!rawMobile || !rawMobile.trim()) {
    return {
      success: false,
      message: 'No WhatsApp number found for this company',
    }
  }

  const toNumber = formatMobile(rawMobile)
  if (toNumber.length < 12) {
    return { success: false, message: 'Invalid WhatsApp mobile number.' }
  }

  const [billedRes, receivedRes] = await Promise.all([
    SellBill.aggregate([
      { $match: { company: id } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$grandTotal', '$totalAmount'] } } } },
    ]),
    PaymentReceipt.aggregate([
      { $match: { company: id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])

  const totalBilled = billedRes[0]?.total ?? 0
  const totalReceived = receivedRes[0]?.total ?? 0
  const totalOutstanding = totalBilled - totalReceived + ((company as any).openingBalance || 0)

  if (totalOutstanding <= 0) {
    return {
      success: false,
      message: 'No outstanding amount for this company.',
    }
  }

  const generatedDate = new Date()
  // Build full statement transactions as in outstanding-pdf
  const [allBills, payments] = await Promise.all([
    SellBill.find({ company: id })
      .sort({ billDate: 1, createdAt: 1 })
      .lean(),
    PaymentReceipt.find({ company: id })
      .sort({ date: 1, createdAt: 1 })
      .lean(),
  ])

  const allTx = [
    ...allBills.map((b) => ({
      date: b.billDate,
      createdAt: b.createdAt,
      description: `INV-${b.billNumber}${
        (b as { notes?: string }).notes
          ? ` — ${(b as { notes?: string }).notes}`
          : ''
      }`,
      debit: (b as { grandTotal?: number }).grandTotal ?? b.totalAmount,
      credit: null as number | null,
    })),
    ...payments.map((p) => ({
      date: (p as any).paymentDate || (p as any).date,
      createdAt: p.createdAt,
      description: `Payment received${
        (p as { notes?: string }).notes
          ? ` — ${(p as { notes?: string }).notes}`
          : ''
      }`,
      debit: null as number | null,
      credit: p.amount,
    })),
  ].sort((a, b) => {
    const ad = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
    const bd = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
    return ad - bd
  })

  let running = (company as any).openingBalance || 0
  let lastZeroBalanceIndex = -1

  const computedTransactions = allTx.map((tx, index) => {
    if (tx.debit) running += tx.debit
    if (tx.credit) running -= tx.credit
    if (Math.abs(running) < 0.001) lastZeroBalanceIndex = index
    return {
      date: tx.date,
      description: tx.description,
      debit: tx.debit,
      credit: tx.credit,
      balance: running,
    }
  })

  let transactions = computedTransactions
  let modifiedOpeningBalance = (company as any).openingBalance || 0
  let modifiedOpeningBalanceNotes = (company as any).openingBalanceNotes

  if (lastZeroBalanceIndex !== -1) {
    transactions = computedTransactions.slice(lastZeroBalanceIndex + 1)
    modifiedOpeningBalance = 0
    modifiedOpeningBalanceNotes = 'Balance Brought Forward (Cleared)'
  }

  const doc = React.createElement(OutstandingTemplate, {
    company: {
      companyName: company.companyName,
      address: (company as { address?: string }).address,
      mobile: (company as { contact1Mobile?: string }).contact1Mobile,
      ownerName: company.ownerName,
      contact1Mobile: (company as { contact1Mobile?: string }).contact1Mobile,
      contact1Name: (company as { contact1Name?: string }).contact1Name,
      openingBalance: modifiedOpeningBalance,
      openingBalanceNotes: modifiedOpeningBalanceNotes,
    },
    transactions,
    generatedDate,
    yourCompanyName: process.env.COMPANY_NAME ?? '',
    yourAddress: process.env.COMPANY_ADDRESS ?? '',
    yourPhone: process.env.COMPANY_PHONE ?? '',
  })

  try {
    const pdfBuffer = await renderToBuffer(doc as any)

    const filename = generateOutstandingFileName(company.companyName)

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([pdfBuffer as any], { type: 'application/pdf' }),
      filename
    )

    const uploadRes = await fetch(
      `${BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` },
        body: formData,
      }
    )
    const uploadJson = (await uploadRes.json()) as {
      id?: string
      error?: { message?: string }
    }
    if (!uploadRes.ok || !uploadJson.id) {
      console.error('WhatsApp outstanding media upload error:', uploadJson)
      return {
        success: false,
        message:
          uploadJson.error?.message ?? 'Failed to upload statement to WhatsApp.',
      }
    }

    const caption = `Dear ${
      company.companyName
    },\n\nYour current outstanding amount is ₹${totalOutstanding.toLocaleString(
      'en-IN'
    )}.\n\nKindly clear the payment at the earliest.\n\nThank you!\n${WHATSAPP_SENDER_NAME}`

    const messageRes = await fetch(
      `${BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNumber,
          type: 'document',
          document: {
            id: uploadJson.id,
            filename,
            caption,
          },
        }),
      }
    )
    const messageJson = (await messageRes.json()) as {
      error?: { message?: string }
    }
    if (!messageRes.ok) {
      console.error('WhatsApp outstanding document send error:', messageJson)
      return {
        success: false,
        message:
          messageJson.error?.message ??
          'Failed to send outstanding statement on WhatsApp.',
      }
    }

    await Company.findByIdAndUpdate(id, {
      lastWhatsappSentAt: new Date(),
      lastWhatsappMessage: caption,
    })

    return {
      success: true,
      message: 'Outstanding statement sent on WhatsApp.',
    }
  } catch (err) {
    console.error('WhatsApp outstanding send error:', err)
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : 'Failed to send outstanding statement.',
    }
  }
}


