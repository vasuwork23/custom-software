import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ChinaPerson from '@/models/ChinaPerson'
import ChinaPersonTransaction from '@/models/ChinaPersonTransaction'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  function toDateTimePreservingDate(dateInput: string, baseDateTime: Date): Date {
    // If client sends only YYYY-MM-DD, JS treats it as UTC midnight.
    // Convert it into a Date with the SAME calendar date, but use time from baseDateTime.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [y, m, d] = dateInput.split('-').map((v) => Number(v))
      return new Date(Date.UTC(y, m - 1, d, baseDateTime.getUTCHours(), baseDateTime.getUTCMinutes(), baseDateTime.getUTCSeconds(), baseDateTime.getUTCMilliseconds()))
    }
    const parsed = new Date(dateInput)
    return new Date(parsed)
  }

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
        { success: false, error: 'Validation failed', message: 'Invalid person id' },
        { status: 400 }
      )
    }
    const body = await req.json()
    const amount = Number(body.amount)
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : undefined

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Amount must be a positive number' },
        { status: 400 }
      )
    }
    await connectDB()
    const createdBy = await resolveCreatedBy(user.id)
    const personId = new mongoose.Types.ObjectId(id)
    const person = await ChinaPerson.findById(personId)
    if (!person) {
      return NextResponse.json(
        { success: false, error: 'Not found', message: 'China person not found' },
        { status: 404 }
      )
    }

    const updatedPerson = await ChinaPerson.findByIdAndUpdate(
      personId,
      { $inc: { currentBalance: Number(amount) }, updatedBy: createdBy },
      { new: true, select: 'currentBalance' }
    )
    const balanceAfter =
      (updatedPerson as { currentBalance?: number } | null)?.currentBalance ?? 0

    // Use transactionDate from client when provided. If it's date-only (YYYY-MM-DD),
    // preserve the date but use the current time so Pay In/Payout order within the same day works.
    const now = new Date()
    const txDate =
      body.transactionDate && typeof body.transactionDate === 'string'
        ? toDateTimePreservingDate(body.transactionDate, now)
        : now

    await ChinaPersonTransaction.create({
      chinaPerson: personId,
      type: 'pay_in',
      amount,
      balanceAfter,
      transactionDate: txDate,
      notes,
      createdBy,
      // Align createdAt with transactionDate for consistent chronological ordering
      createdAt: txDate,
      updatedAt: txDate,
    })

    return NextResponse.json({ success: true, data: { balanceAfter } })
  } catch (error) {
    console.error('Sophia pay-in API Error:', error)
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
