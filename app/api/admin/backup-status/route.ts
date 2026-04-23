import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])

  if (!user || error === 'Unauthorized') {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      },
      { status: 401 }
    )
  }

  if (error === 'Forbidden') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        message: 'You do not have permission to perform this action',
      },
      { status: 403 }
    )
  }

  const atlasConfigured = Boolean(process.env.ATLAS_URI)

  return NextResponse.json({
    success: true,
    atlasConfigured,
  })
}

