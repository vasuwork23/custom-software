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

    const oldAdvanceBank = entry.advanceBankAccount
    const oldAdvanceAmt = entry.advanceAmount

    if (body.hasAdvancePayment === false) {
      entry.advanceAmount = undefined
      entry.advanceBankAccount = undefined
      entry.advanceDate = undefined
      entry.advanceNote = undefined
      if (oldAdvanceBank && (oldAdvanceAmt ?? 0) > 0) {
        const debitTx = await BankTransaction.findOne({
          source: 'india_buying_advance',
          sourceRef: entry._id,
        }).lean()
        if (debitTx) {
          const lastTx = await BankTransaction.findOne({ bankAccount: debitTx.bankAccount })
            .sort({ transactionDate: -1, createdAt: -1 })
            .select('balanceAfter')
            .lean()
          const lastBalance = lastTx?.balanceAfter ?? 0
          const product = await IndiaProduct.findById(entry.product).select('productName').lean()
          const sourceLabel = `Reversal: Advance for India Product: ${product?.productName ?? 'Product'}`
          await BankTransaction.create({
            bankAccount: debitTx.bankAccount,
            type: 'credit',
            amount: debitTx.amount,
            balanceAfter: lastBalance + debitTx.amount,
            source: 'manual',
            sourceLabel,
            transactionDate: new Date(),
            createdBy: updatedBy,
          })
          await BankAccount.findByIdAndUpdate(debitTx.bankAccount, {
            currentBalance: lastBalance + debitTx.amount,
          })
        }
      }
    } else {
      if (body.advanceBankAccount !== undefined)
        entry.advanceBankAccount =
          body.advanceBankAccount == null || body.advanceBankAccount === ''
            ? undefined
            : body.advanceBankAccount
      if (body.advanceAmount !== undefined)
        entry.advanceAmount = body.advanceAmount == null || body.advanceAmount === '' ? undefined : Number(body.advanceAmount)
      if (body.advanceDate !== undefined)
        entry.advanceDate = body.advanceDate == null || body.advanceDate === '' ? undefined : new Date(body.advanceDate)
      if (body.advanceNote !== undefined)
        entry.advanceNote = body.advanceNote == null || body.advanceNote === '' ? undefined : String(body.advanceNote)

      const newAdvanceAmt = entry.hasAdvancePayment ? (entry.advanceAmount ?? 0) : 0
      const newAdvanceBank = entry.advanceBankAccount
      const advanceChanged =
        !oldAdvanceBank ||
        (oldAdvanceAmt ?? 0) !== newAdvanceAmt ||
        String(oldAdvanceBank) !== String(newAdvanceBank)

      if (oldAdvanceBank && (oldAdvanceAmt ?? 0) > 0 && advanceChanged) {
        const debitTx = await BankTransaction.findOne({
          source: 'india_buying_advance',
          sourceRef: entry._id,
        }).lean()
        if (debitTx) {
          const lastTx = await BankTransaction.findOne({ bankAccount: debitTx.bankAccount })
            .sort({ transactionDate: -1, createdAt: -1 })
            .select('balanceAfter')
            .lean()
          const lastBalance = lastTx?.balanceAfter ?? 0
          const product = await IndiaProduct.findById(entry.product).select('productName').lean()
          const sourceLabel = `Reversal: Advance for India Product: ${product?.productName ?? 'Product'}`
          await BankTransaction.create({
            bankAccount: debitTx.bankAccount,
            type: 'credit',
            amount: debitTx.amount,
            balanceAfter: lastBalance + debitTx.amount,
            source: 'manual',
            sourceLabel,
            transactionDate: new Date(),
            createdBy: updatedBy,
          })
          await BankAccount.findByIdAndUpdate(debitTx.bankAccount, {
            currentBalance: lastBalance + debitTx.amount,
          })
        }
      }

      if (newAdvanceAmt > 0 && newAdvanceBank && advanceChanged) {
        const product = await IndiaProduct.findById(entry.product).select('productName').lean()
        const sourceLabel = `Advance for India Product: ${product?.productName ?? 'Product'}`
        const bankId =
          typeof newAdvanceBank === 'object' && newAdvanceBank != null
            ? newAdvanceBank
            : new mongoose.Types.ObjectId(String(newAdvanceBank))
        const lastTx = await BankTransaction.findOne({ bankAccount: bankId })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        await BankTransaction.create({
          bankAccount: bankId,
          type: 'debit',
          amount: newAdvanceAmt,
          balanceAfter: lastBalance - newAdvanceAmt,
          source: 'india_buying_advance',
          sourceRef: entry._id,
          sourceLabel,
          transactionDate: entry.advanceDate ?? new Date(),
          notes: entry.advanceNote,
          createdBy: updatedBy,
        })
        await BankAccount.findByIdAndUpdate(bankId, {
          currentBalance: lastBalance - newAdvanceAmt,
        })
      }
    }

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
      const debitTx = await BankTransaction.findOne({
        source: 'india_buying_advance',
        sourceRef: id,
      }).lean()
      if (debitTx) {
        const updatedBy = await resolveCreatedBy(user.id)
        const lastTx = await BankTransaction.findOne({ bankAccount: debitTx.bankAccount })
          .sort({ transactionDate: -1, createdAt: -1 })
          .select('balanceAfter')
          .lean()
        const lastBalance = lastTx?.balanceAfter ?? 0
        const product = await IndiaProduct.findById(entry.product).select('productName').lean()
        const sourceLabel = `Reversal: Advance for India Product: ${product?.productName ?? 'Product'} (deleted entry)`
        await BankTransaction.create({
          bankAccount: debitTx.bankAccount,
          type: 'credit',
          amount: debitTx.amount,
          balanceAfter: lastBalance + debitTx.amount,
          source: 'manual',
          sourceLabel,
          transactionDate: new Date(),
          createdBy: updatedBy,
        })
        await BankAccount.findByIdAndUpdate(debitTx.bankAccount, {
          currentBalance: lastBalance + debitTx.amount,
        })
      }
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
