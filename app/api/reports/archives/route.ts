import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { listArchives } from '@/lib/year-reset/archive'

export const dynamic = 'force-dynamic'

/**
 * Past years kept on this server, newest first.
 *
 * Anyone who can read reports can list these — they hold the same figures the
 * reports already show, just frozen. Nothing here writes.
 */
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
    const archives = await listArchives()
    return NextResponse.json({ success: true, data: { archives } })
  } catch (err) {
    console.error('Report archives API Error:', err)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
