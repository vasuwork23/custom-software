import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
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
        { success: false, error: 'Validation failed', message: 'Invalid Sophia id' },
        { status: 400 }
      )
    }
    await connectDB()
    const person = await ChinaPerson.findById(id).lean()
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }
    const counts = await ChinaPersonTransaction.aggregate([
      { $match: { chinaPerson: person._id } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ])
    const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]))
    return NextResponse.json({
      success: true,
      data: {
        _id: person._id,
        name: person.name,
        isDefault: person.isDefault,
        currentBalance: person.currentBalance ?? 0,
        payInCount: countMap['pay_in'] ?? 0,
        payOutCount: countMap['pay_out'] ?? 0,
      },
    })
  } catch (error) {
    console.error('Sophia detail API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid Sophia id' },
        { status: 400 }
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
    const updatedBy = await resolveCreatedBy(user.id)
    const person = await ChinaPerson.findById(id)
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }
    if (person.isDefault) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Cannot edit default China person' },
        { status: 403 }
      )
    }
    person.name = name
    person.updatedBy = updatedBy
    await person.save()
    return NextResponse.json({ success: true, data: { _id: person._id } })
  } catch (error) {
    console.error('Sophia update API Error:', error)
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
        { success: false, error: 'Validation failed', message: 'Invalid Sophia id' },
        { status: 400 }
      )
    }
    await connectDB()
    const person = await ChinaPerson.findById(id).lean()
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }
    if (person.isDefault) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: 'Cannot delete default China person' },
        { status: 403 }
      )
    }
    const hasTx = await ChinaPersonTransaction.exists({ chinaPerson: person._id })
    if (hasTx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cannot delete person with transactions. Please delete all transactions first.',
        },
        { status: 403 }
      )
    }
    await ChinaPerson.findByIdAndDelete(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error('Sophia delete API Error:', error)
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

