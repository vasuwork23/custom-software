import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import BuyingPayment from '@/models/BuyingPayment'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

async function ensureSophiaPerson(createdBy: mongoose.Types.ObjectId): Promise<void> {
  const existingDefault = await ChinaPerson.findOne({ isDefault: true })
  if (existingDefault) {
    if (existingDefault.name !== 'Sophia') {
      existingDefault.name = 'Sophia'
      existingDefault.updatedBy = createdBy
      await existingDefault.save()
    }
    return
  }
  await ChinaPerson.create({
    name: 'Sophia',
    isDefault: true,
    currentBalance: 0,
    createdBy,
    updatedBy: createdBy,
  })
}

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
    const createdBy = await resolveCreatedBy(user.id)
    await ensureSophiaPerson(createdBy)

    const persons = await ChinaPerson.find({}).sort({ isDefault: -1, name: 1 }).lean()
    const ids = persons.map((p) => p._id)

    const [txAgg, paymentCounts] = await Promise.all([
      ChinaPersonTransaction.aggregate([
        { $match: { chinaPerson: { $in: ids } } },
        {
          $group: {
            _id: { person: '$chinaPerson', type: '$type' },
            count: { $sum: 1 },
          },
        },
      ]),
      BuyingPayment.aggregate([
        { $match: { chinaPerson: { $in: ids } } },
        { $group: { _id: '$chinaPerson', count: { $sum: 1 } } },
      ]),
    ])

    const counts = new Map<string, { payIn: number; payOut: number }>()
    for (const row of txAgg) {
      const key = String(row._id.person)
      const entry = counts.get(key) ?? { payIn: 0, payOut: 0 }
      if (row._id.type === 'pay_in') entry.payIn = row.count
      if (row._id.type === 'pay_out') entry.payOut = row.count
      counts.set(key, entry)
    }
    const paymentsMadeMap = new Map<string, number>()
    for (const row of paymentCounts) {
      paymentsMadeMap.set(String(row._id), row.count)
    }

    const list = persons.map((p) => {
      const c = counts.get(String(p._id)) ?? { payIn: 0, payOut: 0 }
      return {
        _id: p._id,
        name: p.name,
        isDefault: p.isDefault,
        currentBalance: p.currentBalance ?? 0,
        payInCount: c.payIn,
        payOutCount: c.payOut,
        paymentsMadeCount: paymentsMadeMap.get(String(p._id)) ?? 0,
      }
    })

    return NextResponse.json({ success: true, data: { persons: list } })
  } catch (error) {
    console.error('Sophia list API Error:', error)
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
    const name = body.name != null ? String(body.name).trim() : ''
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Name is required' },
        { status: 400 }
      )
    }

    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)

    const person = await ChinaPerson.create({
      name,
      isDefault: false,
      currentBalance: 0,
      createdBy,
      updatedBy: createdBy,
    })

    return NextResponse.json({ success: true, data: { _id: person._id } })
  } catch (error) {
    console.error('Sophia create API Error:', error)
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

