import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import '@/lib/register-models'
import Liability from '@/models/Liability'

export const dynamic = 'force-dynamic'

export async function DELETE(
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

    if (liability.status !== 'unblocked') {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          message: 'Only unblocked liabilities can be deleted',
        },
        { status: 400 }
      )
    }

    await Liability.findByIdAndDelete(params.id)

    return NextResponse.json({
      success: true,
      data: { deleted: params.id },
    })
  } catch (error) {
    console.error('Liabilities delete API Error:', error)
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

