import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Liability from '@/models/Liability'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const body = await req.json()
    const { unblockedReason } = body ?? {}

    const liability = await Liability.findById(params.id)
    if (!liability) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Liability not found',
        },
        { status: 404 }
      )
    }

    if (liability.status === 'unblocked') {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Liability already unblocked',
        },
        { status: 400 }
      )
    }

    if (liability.source === 'cash') {
      liability.status = 'unblocked'
      liability.unblockedAt = new Date()
      liability.unblockedReason =
        (typeof unblockedReason === 'string' && unblockedReason.trim()) ||
        'Unblocked'
      await liability.save()

      const { createCashTransaction } = await import('@/lib/cash-transaction-helper')
      await createCashTransaction({
        type: 'credit', // Credit cash because unblocking adds it back to available cash stack
        amount: liability.amount,
        description: `Liability unblocked: ${liability.reason}`,
        date: new Date(),
        category: 'other',
        referenceId: liability._id as any,
        referenceType: 'liability_unblock',
      })

      return NextResponse.json({
        success: true,
        data: liability,
      })
    }

    const bankAccount = await BankAccount.findById(liability.bankAccountId)
    if (!bankAccount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Bank account not found for liability',
        },
        { status: 400 }
      )
    }

    const newBalance = (bankAccount.currentBalance ?? 0) + liability.amount
    bankAccount.currentBalance = newBalance
    bankAccount.updatedBy = createdBy
    await bankAccount.save()

    liability.status = 'unblocked'
    liability.unblockedAt = new Date()
    liability.unblockedReason =
      (typeof unblockedReason === 'string' && unblockedReason.trim()) ||
      'Unblocked'
    await liability.save()

    await BankTransaction.create({
      bankAccount: bankAccount._id,
      type: 'credit',
      amount: liability.amount,
      balanceAfter: newBalance,
      source: 'manual',
      sourceRef: liability._id,
      sourceLabel: 'liability_unblock',
      transactionDate: new Date(),
      notes: `Liability unblocked: ${liability.reason}`,
      createdBy,
    })

    return NextResponse.json({
      success: true,
      data: liability,
    })
  } catch (error) {
    console.error('Liabilities unblock API Error:', error)
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

