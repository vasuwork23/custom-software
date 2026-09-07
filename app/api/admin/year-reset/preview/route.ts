import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import { runPreflight } from '@/lib/year-reset/preflight'
import { buildPlan } from '@/lib/year-reset/plan'
import { verifyOwnPassword } from '@/lib/year-reset/verify-password'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Build the reset plan and hand it back without changing anything.
 *
 * POST rather than GET because it carries the password and the in-transit
 * decisions. Execute will run on an identical plan object, so what is shown
 * here is what happens.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])

  if (error === 'Forbidden') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', message: 'Only Owner can preview a reset' },
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
    const body = (await req.json().catch(() => ({}))) as {
      password?: unknown
      releaseInTransit?: unknown
      counterSeq?: unknown
    }

    const pw = await verifyOwnPassword(user.id, body.password)
    if (!pw.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: pw.message },
        { status: 403 }
      )
    }

    // Re-checked server-side: the data can move between looking and acting.
    const preflight = await runPreflight()
    if (!preflight.canProceed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Preflight failed',
          message: `${preflight.blockers} unresolved issue${preflight.blockers === 1 ? '' : 's'} — clear them before previewing`,
          data: { preflight },
        },
        { status: 409 }
      )
    }

    const releaseInTransit = Array.isArray(body.releaseInTransit)
      ? body.releaseInTransit.filter((x): x is string => typeof x === 'string')
      : []
    const counterSeq =
      typeof body.counterSeq === 'number' && Number.isFinite(body.counterSeq) && body.counterSeq >= 0
        ? Math.floor(body.counterSeq)
        : 1000

    const plan = await buildPlan(new Date(), { releaseInTransit, counterSeq })

    return NextResponse.json({ success: true, data: { plan, preflight } })
  } catch (err) {
    console.error('Year reset preview API Error:', err)
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
