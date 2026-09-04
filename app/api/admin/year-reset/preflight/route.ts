import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { runPreflight } from '@/lib/year-reset/preflight'

export const dynamic = 'force-dynamic'

/**
 * Year-end reset pre-flight — GET because it only reads.
 *
 * Owner only. Reports every inconsistency it finds and returns canProceed:false
 * while any blocker stands. It never writes, and never calls a repair route:
 * recomputing a stored balance from a ledger whose rows were deleted without
 * rebalancing would erase the discrepancy instead of surfacing it.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])

  // Order matters: requireAuth returns user:null for BOTH cases, so Forbidden has
  // to be checked first or a signed-in non-owner is reported as unauthenticated.
  if (error === 'Forbidden') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', message: 'Only Owner can run the reset pre-flight' },
      { status: 403 }
    )
  }
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
      { status: 401 }
    )
  }

  try {
    await connectDB()
    const report = await runPreflight()
    return NextResponse.json({ success: true, data: report })
  } catch (err) {
    console.error('Year reset preflight API Error:', err)
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
