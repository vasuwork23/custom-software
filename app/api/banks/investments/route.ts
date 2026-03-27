import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Investment from '@/models/Investment'

export const dynamic = 'force-dynamic'

const createInvestmentSchema = z.object({
  investorName: z.string().min(1, 'Investor name is required'),
})

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
    const investments = await Investment.find({})
      .sort({ investorName: 1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: {
        investments: investments.map((row) => ({
          _id: row._id,
          investorName: row.investorName,
          currentBalance: row.currentBalance ?? 0,
        })),
      },
    })
  } catch (error) {
    console.error('Investment list API Error:', error)
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
    const validated = createInvestmentSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: validated.error.errors[0]?.message ?? 'Invalid input',
        },
        { status: 400 }
      )
    }

    const investorName = validated.data.investorName.trim()
    if (!investorName) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Investor name is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const exists = await Investment.findOne({ investorName }).lean()
    if (exists) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Investor already exists' },
        { status: 400 }
      )
    }

    const created = await Investment.create({
      investorName,
      currentBalance: 0,
      createdBy,
      updatedBy: createdBy,
    })

    return NextResponse.json({
      success: true,
      data: {
        _id: created._id,
        investorName: created.investorName,
        currentBalance: created.currentBalance,
      },
    })
  } catch (error) {
    console.error('Investment create API Error:', error)
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
