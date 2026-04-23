import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { sendOutstandingOnWhatsApp } from '@/lib/whatsapp'
import Company from '@/models/Company'

export const dynamic = 'force-dynamic'

export async function POST(
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
        { success: false, error: 'Validation failed', message: 'Invalid company id' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const primaryMobileInput =
      body.primaryMobile != null && String(body.primaryMobile).trim()
        ? String(body.primaryMobile).trim()
        : undefined
    const mobileOverride =
      body.mobileNumber != null && String(body.mobileNumber).trim()
        ? String(body.mobileNumber).trim()
        : primaryMobileInput

    await connectDB()
    // Ensure model registered
    void Company

    if (primaryMobileInput) {
      await Company.findByIdAndUpdate(id, { primaryMobile: primaryMobileInput })
    }

    const result = await sendOutstandingOnWhatsApp(id, mobileOverride)
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'WhatsAppError', message: result.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, data: { message: result.message } })
  } catch (error) {
    console.error('Company WhatsApp outstanding API Error:', error)
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

