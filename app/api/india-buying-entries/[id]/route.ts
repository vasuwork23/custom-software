import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import IndiaProduct from '@/models/IndiaProduct'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import SellBillItem from '@/models/SellBillItem'
import mongoose from 'mongoose'
import { format } from 'date-fns'
import { recalcIndiaBuyingEntryGivenAndStatus } from '@/lib/india-buying-entry-payments'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await IndiaBuyingEntry.findById(id).lean().populate('product', 'productName')
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India buying entry not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: entry })
  } catch (error) {
    console.error('India buying entry get API Error:', error)
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }
    const body = await req.json()

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)

    let entry = await IndiaBuyingEntry.findById(id)
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India buying entry not found' },
        { status: 404 }
      )
    }

    const soldCtn = (entry.totalCtn ?? 0) - (entry.availableCtn ?? 0)
    if (body.totalCtn != null) {
      const newTotalCtn = Number(body.totalCtn)
      if (newTotalCtn < soldCtn) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            message: `Cannot reduce total CTN to ${newTotalCtn} — ${soldCtn} CTN already sold from this entry`,
          },
          { status: 400 }
        )
      }
    }

    const costingFields = ['totalCtn', 'qty', 'rate'] as const
    if (soldCtn > 0) {
      const changedCosting = costingFields.some((f) => {
        const bodyVal = body[f]
        if (bodyVal === undefined) return false
        const current = entry.get(f)
        return Number(current) !== Number(bodyVal)
      })
      if (changedCosting) {
        return NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            message: `Cannot edit costing fields — ${soldCtn} CTN already sold from this entry. Please revert the sale bills first.`,
          },
          { status: 400 }
        )
      }
    }

    // === Advance diff-only model ===
    const oldAdvance = entry.hasAdvancePayment ? Number(entry.advanceAmount ?? 0) : 0
    const oldBank = entry.advanceBankAccount
      ? String(entry.advanceBankAccount)
      : undefined

    const newHasAdvance: boolean =
      body.hasAdvancePayment !== undefined
        ? !!body.hasAdvancePayment
        : !!entry.hasAdvancePayment
    const newAdvance = newHasAdvance ? Number(body.advanceAmount ?? 0) : 0
    const newBankRaw =
      body.advanceBankAccount == null || body.advanceBankAccount === ''
        ? undefined
        : String(body.advanceBankAccount ?? oldBank)
    const bankChanged =
      (oldBank ?? undefined) !== (newBankRaw ?? undefined)
    const product = await IndiaProduct.findById(entry.product)
      .select('productName')
      .lean()
    const productName = product?.productName ?? 'India Product'

    if (newHasAdvance && newAdvance > 0 && !newBankRaw) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Please select a bank account for the advance payment',
        },
        { status: 400 }
      )
    }

    if (bankChanged) {
      // Fully reverse old advance from old bank.
      if (oldAdvance > 0 && oldBank) {
        const lastTx = await BankTransaction.findOne({
          bankAccount: oldBank,
        })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const newBalance = lastBalance + oldAdvance
        await BankTransaction.create({
          bankAccount: oldBank,
          type: 'credit',
          amount: oldAdvance,
          balanceAfter: newBalance,
          source: 'india_buying_advance',
          sourceRef: entry._id,
          sourceLabel:
            'Advance refunded — bank account changed (India buying entry)',
          transactionDate: new Date(),
          createdBy: updatedBy,
        })
        await BankAccount.findByIdAndUpdate(oldBank, {
          currentBalance: newBalance,
        })
      }

      // Debit full new advance to new bank.
      if (newHasAdvance && newAdvance > 0 && newBankRaw) {
        const lastTx = await BankTransaction.findOne({
          bankAccount: newBankRaw,
        })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const newBalance = lastBalance - newAdvance
        await BankTransaction.create({
          bankAccount: newBankRaw,
          type: 'debit',
          amount: newAdvance,
          balanceAfter: newBalance,
          source: 'india_buying_advance',
          sourceRef: entry._id,
          sourceLabel: `Advance for India buying entry — ${productName}`,
          transactionDate: new Date(),
          notes: body.advanceNote ?? entry.advanceNote,
          createdBy: updatedBy,
        })
        await BankAccount.findByIdAndUpdate(newBankRaw, {
          currentBalance: newBalance,
        })
      }
    } else {
      // Same bank account; only apply diff between new and old advance.
      const diff = newAdvance - oldAdvance
      const bankId = newBankRaw ?? oldBank
      if (diff !== 0 && bankId) {
        const lastTx = await BankTransaction.findOne({
          bankAccount: bankId,
        })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const newBalance =
          diff > 0 ? lastBalance - Math.abs(diff) : lastBalance + Math.abs(diff)
        await BankTransaction.create({
          bankAccount: bankId,
          type: diff > 0 ? 'debit' : 'credit',
          amount: Math.abs(diff),
          balanceAfter: newBalance,
          source: 'india_buying_advance',
          sourceRef: entry._id,
          sourceLabel:
            diff > 0
              ? `Advance increased — India buying entry (${productName})`
              : `Advance reduced — India buying entry (${productName})`,
          transactionDate: new Date(),
          notes: body.advanceNote ?? entry.advanceNote,
          createdBy: updatedBy,
        })
        await BankAccount.findByIdAndUpdate(bankId, {
          currentBalance: newBalance,
        })
      }
    }

    // Persist new advance fields on the entry.
    entry.hasAdvancePayment = newHasAdvance
    entry.advanceAmount =
      newHasAdvance && newAdvance > 0 ? newAdvance : undefined
    entry.advanceBankAccount =
      newHasAdvance && newBankRaw
        ? new mongoose.Types.ObjectId(newBankRaw)
        : undefined
    entry.advanceDate =
      newHasAdvance && body.advanceDate
        ? new Date(body.advanceDate)
        : entry.advanceDate
    entry.advanceNote =
      newHasAdvance && body.advanceNote != null
        ? String(body.advanceNote)
        : entry.advanceNote

    if (body.totalCtn != null) entry.totalCtn = Number(body.totalCtn)
    if (body.qty != null) entry.qty = Number(body.qty)
    if (body.rate != null) entry.rate = Number(body.rate)
    if (body.entryDate != null) entry.entryDate = new Date(body.entryDate)
    entry.updatedBy = updatedBy

    await entry.save()
    await recalcIndiaBuyingEntryGivenAndStatus(new mongoose.Types.ObjectId(id))

    const updated = await IndiaBuyingEntry.findById(id).lean().populate('product', 'productName')
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('India buying entry update API Error:', error)
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const { id } = await params
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid id', message: 'Invalid entry id' },
        { status: 400 }
      )
    }

    await connectDB()

    const entry = await IndiaBuyingEntry.findById(id).lean()
    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'India buying entry not found' },
        { status: 404 }
      )
    }

    const hasSales = await SellBillItem.exists({
      'fifoBreakdown.indiaBuyingEntry': new mongoose.Types.ObjectId(id),
    })
    if (hasSales) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete India buying entry that has sales. Remove related sale bill items first.',
        },
        { status: 403 }
      )
    }

    if (entry.hasAdvancePayment && (entry.advanceAmount ?? 0) > 0 && entry.advanceBankAccount) {
      const updatedBy = await resolveCreatedBy(user.id)
      const amount = Number(entry.advanceAmount ?? 0)
      const bankId = String(entry.advanceBankAccount)
      const product = await IndiaProduct.findById(entry.product).select('productName').lean()
      const productName = product?.productName ?? 'India Product'

      const lastTx = await BankTransaction.findOne({ bankAccount: bankId })
        .sort({ transactionDate: -1, createdAt: -1 })
        .select('balanceAfter')
        .lean()
      const lastBalance = lastTx?.balanceAfter ?? 0
      const newBalance = lastBalance + amount

      await BankTransaction.create({
        bankAccount: bankId,
        type: 'credit',
        amount,
        balanceAfter: newBalance,
        source: 'india_buying_advance',
        sourceRef: entry._id,
        sourceLabel: `Reversal: Advance for India Product: ${productName} (deleted entry)`,
        transactionDate: new Date(),
        createdBy: updatedBy,
      })
      await BankAccount.findByIdAndUpdate(bankId, {
        currentBalance: newBalance,
      })
    }

    await IndiaBuyingEntry.findByIdAndDelete(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('India buying entry delete API Error:', error)
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
