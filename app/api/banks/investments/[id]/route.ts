import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Investment from '@/models/Investment'
import InvestmentTransaction from '@/models/InvestmentTransaction'

export const dynamic = 'force-dynamic'

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
        { success: false, error: 'Validation failed', message: 'Invalid investor id' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const investorName = body.investorName != null ? String(body.investorName).trim() : ''
    if (!investorName) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Investor name is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const updatedBy = await resolveCreatedBy(user.id)
    const investment = await Investment.findById(id)
    if (!investment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investor not found' },
        { status: 404 }
      )
    }

    const duplicate = await Investment.findOne({
      _id: { $ne: investment._id },
      investorName,
    }).lean()
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Investor name already exists' },
        { status: 400 }
      )
    }

    investment.investorName = investorName
    investment.updatedBy = updatedBy
    await investment.save()

    const updated = await Investment.findById(id).lean()
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Investment update API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid investor id' },
        { status: 400 }
      )
    }

    await connectDB()
    const investment = await Investment.findById(id).lean()
    if (!investment) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'Investor not found' },
        { status: 404 }
      )
    }

    const balance = investment.currentBalance ?? 0
    if (balance !== 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: `Cannot delete — balance is ₹${balance.toLocaleString('en-IN')}. Balance must be zero before deleting.`,
        },
        { status: 400 }
      )
    }

    await InvestmentTransaction.deleteMany({ investment: investment._id })
    await Investment.findByIdAndDelete(investment._id)

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Investment delete API Error:', error)
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
