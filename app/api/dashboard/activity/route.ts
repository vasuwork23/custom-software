import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import SellBill from '@/models/SellBill'
import PaymentReceipt from '@/models/PaymentReceipt'
import BuyingEntry from '@/models/BuyingEntry'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import ChinaBankTransaction from '@/models/ChinaBankTransaction'
import Expense from '@/models/Expense'
import Company from '@/models/Company'
import Product from '@/models/Product'
import IndiaProduct from '@/models/IndiaProduct'
import mongoose from 'mongoose'

export const revalidate = 300

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    await connectDB()
    // Ensure models are registered for populate
    void SellBill
    void Product
    void IndiaProduct
    // Extra safety for serverless bundling: dynamically import models
    await Promise.all([
      import('@/models/SellBill').then(() => undefined).catch(() => undefined),
      import('@/models/Product').then(() => undefined).catch(() => undefined),
      import('@/models/IndiaProduct').then(() => undefined).catch(() => undefined),
    ])

    const [bills, receipts, chinaEntries, indiaEntries, chinaBankTx, expenses] =
      await Promise.all([
        SellBill.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('company', 'companyName')
          .lean(),
        PaymentReceipt.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('company', 'companyName')
          .lean(),
        BuyingEntry.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('product', 'productName')
          .lean(),
        IndiaBuyingEntry.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('product', 'productName')
          .lean(),
        ChinaBankTransaction.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        Expense.find({})
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ])

    type ActivityItem = {
      icon: string
      type: string
      description: string
      amount?: number
      createdAt: Date
      link?: string
    }

    const items: ActivityItem[] = []

    for (const b of bills as any[]) {
      items.push({
        icon: '🧾',
        type: 'sale-bill',
        description: `Bill #${b.billNumber} created for ${
          (b.company as { companyName?: string })?.companyName ?? '—'
        }`,
        amount: b.totalAmount ?? 0,
        createdAt: b.createdAt,
        link: `/sale-bills/${String(b._id)}`,
      })
    }

    for (const r of receipts as any[]) {
      items.push({
        icon: '💰',
        type: 'payment-receipt',
        description: `Payment received from ${
          (r.company as { companyName?: string })?.companyName ?? '—'
        }`,
        amount: r.amount ?? 0,
        createdAt: r.createdAt,
        link: `/companies/${String(r.company)}`,
      })
    }

    for (const e of chinaEntries as any[]) {
      items.push({
        icon: '📦',
        type: 'buying-entry',
        description: `New buying entry added for ${
          (e.product as { productName?: string })?.productName ?? '—'
        }`,
        createdAt: e.createdAt,
        link: `/products/${String(e.product)}`,
      })
    }

    for (const e of indiaEntries as any[]) {
      items.push({
        icon: '🇮🇳',
        type: 'india-buying-entry',
        description: `India buying entry added for ${
          (e.product as { productName?: string })?.productName ?? '—'
        }`,
        createdAt: e.createdAt,
        link: `/products/india/${String(e.product)}`,
      })
    }

    for (const tx of chinaBankTx as any[]) {
      if (tx.type === 'debit') {
        items.push({
          icon: '🔒',
          type: 'china-bank-debit',
          description: `Entry locked — ₹${tx.amount?.toLocaleString('en-IN')} debited from China Bank`,
          amount: tx.amount ?? 0,
          createdAt: tx.createdAt,
          link: '/china-bank',
        })
      } else if (tx.type === 'credit') {
        items.push({
          icon: '🏦',
          type: 'china-bank-credit',
          description: `₹${tx.amount?.toLocaleString('en-IN')} credited to China Bank`,
          amount: tx.amount ?? 0,
          createdAt: tx.createdAt,
          link: '/china-bank',
        })
      }
    }

    for (const ex of expenses as any[]) {
      items.push({
        icon: '💸',
        type: 'expense',
        description: `Expense: ${ex.title}`,
        amount: ex.amount ?? 0,
        createdAt: ex.createdAt,
        link: '/expenses',
      })
    }

    items.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )

    const limited = items.slice(0, 10)

    return NextResponse.json({
      success: true,
      data: limited,
    })
  } catch (error) {
    console.error('Dashboard activity API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

