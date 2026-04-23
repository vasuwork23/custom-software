import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaBuyingPayment from '@/models/IndiaBuyingPayment'
import PaymentReceipt from '@/models/PaymentReceipt'
import Company from '@/models/Company'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'
import { recalcIndiaBuyingEntryGivenAndStatus } from '@/lib/india-buying-entry-payments'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { searchParams } = new URL(req.url)
    const buyingEntryId = searchParams.get('buyingEntryId')
    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const payments = await IndiaBuyingPayment.find({ buyingEntry: buyingEntryId })
      .sort({ paymentDate: -1, createdAt: -1 })
      .populate('bankAccount', 'accountName')
      .populate('company', 'companyName')
      .lean()

    const list = payments.map((p) => ({
      _id: p._id,
      buyingEntry: p.buyingEntry,
      product: p.product,
      bankAccount: p.bankAccount,
      bankAccountName: (p.bankAccount as { accountName?: string })?.accountName,
      company: p.company,
      companyName: (p.company as unknown as { companyName?: string })?.companyName,
      paymentSource: p.paymentSource ?? 'bank',
      amount: p.amount,
      paymentDate: p.paymentDate,
      notes: p.notes,
    }))

    return NextResponse.json({ success: true, data: { payments: list } })
  } catch (error) {
    console.error('India buying payments list API Error:', error)
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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const body = await req.json()
    const buyingEntryId = body.buyingEntryId ?? body.buyingEntry
    const bankAccountId = body.bankAccountId ?? body.bankAccount
    const companyId = body.companyId ?? body.company
    const paymentSource: 'bank' | 'company' = companyId ? 'company' : 'bank'
    const amount = Number(body.amount)
    const paymentDateRaw = body.paymentDate
    const notes =
      body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : undefined

    if (!buyingEntryId || !mongoose.Types.ObjectId.isValid(buyingEntryId)) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'buyingEntryId is required' },
        { status: 400 }
      )
    }
    if (paymentSource === 'bank') {
      if (!bankAccountId || !mongoose.Types.ObjectId.isValid(bankAccountId)) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: 'bankAccountId is required' },
          { status: 400 }
        )
      }
    } else {
      if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', message: 'companyId is required' },
          { status: 400 }
        )
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Amount must be a positive number (INR)' },
        { status: 400 }
      )
    }
    const paymentDate = paymentDateRaw ? new Date(paymentDateRaw) : new Date()
    if (Number.isNaN(paymentDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Invalid payment date' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    const entry = await IndiaBuyingEntry.findById(buyingEntryId).populate('product', 'productName').lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India buying entry not found' },
        { status: 404 }
      )
    }

    const productName = (entry.product as { productName?: string })?.productName ?? 'India Product'
    const entryDateStr = format(new Date(entry.entryDate), 'dd MMM yyyy')
    const sourceLabel = `Payment for India Product: ${productName} - ${entryDateStr}`
    const setOffRemark = `${productName} @ ${entry.rate}`

    let linkedPaymentReceiptId: mongoose.Types.ObjectId | undefined

    if (paymentSource === 'company') {
      // Company set-off path: create a PaymentReceipt with paymentMode 'set_off'
      const company = await Company.findById(companyId).select('_id').lean()
      if (!company) {
        return NextResponse.json(
          { success: false, error: 'Not found', message: 'Company not found' },
          { status: 404 }
        )
      }
      const receipt = await PaymentReceipt.create({
        company: companyId,
        amount,
        paymentMode: 'set_off',
        paymentDate,
        remark: setOffRemark,
        companyNote: notes,
        createdBy,
        updatedBy: createdBy,
      })
      linkedPaymentReceiptId = receipt._id as mongoose.Types.ObjectId
    } else {
      // Bank path
      const bank = await BankAccount.findById(bankAccountId)
      if (!bank) {
        return NextResponse.json(
          { success: false, error: 'Not found', message: 'Bank account not found' },
          { status: 404 }
        )
      }
      const bankAcct = await BankAccount.findById(bankAccountId).select('type').lean()
      if (bankAcct?.type === 'cash') {
        const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
        await createCashTransaction({
          type: 'debit',
          amount,
          description: sourceLabel + (notes ? ` - ${notes}` : ''),
          date: paymentDate,
          category: 'other',
          referenceId: entry._id as mongoose.Types.ObjectId,
          referenceType: 'india_buying_payment',
        })
      } else {
        const balAgg = await BankTransaction.aggregate([
          { $match: { bankAccount: new mongoose.Types.ObjectId(bankAccountId) } },
          {
            $group: {
              _id: null,
              balance: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }],
                },
              },
            },
          },
        ])
        const currentLedgerBalance = balAgg[0]?.balance ?? 0
        const newBalance = parseFloat((currentLedgerBalance - amount).toFixed(2))

        await BankTransaction.create({
          bankAccount: bankAccountId,
          type: 'debit',
          amount,
          balanceAfter: newBalance,
          source: 'india_buying_payment',
          sourceRef: entry._id,
          sourceLabel,
          transactionDate: paymentDate,
          notes,
          createdBy,
        })
        await BankAccount.findByIdAndUpdate(bankAccountId, { currentBalance: newBalance })
      }
    }

    await IndiaBuyingPayment.create({
      buyingEntry: buyingEntryId,
      product: entry.product,
      ...(paymentSource === 'bank' ? { bankAccount: bankAccountId } : { company: companyId }),
      paymentSource,
      linkedPaymentReceiptId,
      amount,
      paymentDate,
      notes,
      createdBy,
    })

    await recalcIndiaBuyingEntryGivenAndStatus(new mongoose.Types.ObjectId(buyingEntryId))

    const payments = await IndiaBuyingPayment.find({ buyingEntry: buyingEntryId })
      .sort({ paymentDate: -1 })
      .populate('bankAccount', 'accountName')
      .populate('company', 'companyName')
      .lean()
    return NextResponse.json({ success: true, data: { payments } })
  } catch (error) {
    console.error('India buying payment create API Error:', error)
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
