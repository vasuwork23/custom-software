import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'
import mongoose from 'mongoose'

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
        { success: false, error: 'Validation failed', message: 'Invalid account id' },
        { status: 400 }
      )
    }
    await connectDB()
    const account = await BankAccount.findById(id).lean()
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Bank account not found' },
        { status: 404 }
      )
    }
    const transactionCount = await BankTransaction.countDocuments({ bankAccount: id })
    return NextResponse.json({
      success: true,
      data: { ...account, transactionCount },
    })
  } catch (error) {
    console.error('Bank get API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid account id' },
        { status: 400 }
      )
    }
    const body = await req.json()
    const accountName = body.accountName != null ? String(body.accountName).trim() : ''
    if (!accountName) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Account name is required' },
        { status: 400 }
      )
    }
    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)
    const account = await BankAccount.findById(id)
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Bank account not found' },
        { status: 404 }
      )
    }
    account.accountName = accountName
    account.updatedBy = updatedBy
    await account.save()
    const updated = await BankAccount.findById(id).lean()
    const transactionCount = await BankTransaction.countDocuments({ bankAccount: id })
    return NextResponse.json({ success: true, data: { ...updated, transactionCount } })
  } catch (error) {
    console.error('Bank update API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid account id' },
        { status: 400 }
      )
    }
    await connectDB()
    const account = await BankAccount.findById(id).lean()
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Bank account not found' },
        { status: 404 }
      )
    }
    if (account.isDefault) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'The Cash entity cannot be deleted.',
        },
        { status: 403 }
      )
    }

    const currentBalance = (account as { currentBalance?: number }).currentBalance ?? 0
    if (currentBalance !== 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: `Cannot delete — balance is ₹${currentBalance.toLocaleString(
            'en-IN'
          )}. Balance must be zero before deleting.`,
        },
        { status: 400 }
      )
    }

    await BankTransaction.deleteMany({ bankAccount: id })
    await BankAccount.findByIdAndDelete(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Bank delete API Error:', error)
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
