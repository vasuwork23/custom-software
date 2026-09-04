import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { requireAuth, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ResetRun from '@/models/ResetRun'
import { runPreflight } from '@/lib/year-reset/preflight'
import { buildPlan } from '@/lib/year-reset/plan'
import { executePlan } from '@/lib/year-reset/execute'
import { verifyOwnPassword } from '@/lib/year-reset/verify-password'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** A snapshot older than this is not a safety net you would want to rely on. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Run the reset.
 *
 * Guarded four ways: owner role, the owner's own password, a typed confirmation,
 * and a snapshot taken within the last few hours. The plan is rebuilt here rather
 * than accepted from the browser — a plan is a set of instructions, and one
 * arriving over the wire is not something to execute on trust.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])

  if (error === 'Forbidden') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', message: 'Only Owner can run the reset' },
      { status: 403 }
    )
  }
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', message: 'Invalid or expired token' },
      { status: 401 }
    )
  }

  let run: { _id: unknown } | null = null
  try {
    await connectDB()
    const body = (await req.json().catch(() => ({}))) as {
      password?: unknown
      confirm?: unknown
      releaseInTransit?: unknown
      counterSeq?: unknown
    }

    const pw = await verifyOwnPassword(user.id, body.password)
    if (!pw.ok) {
      return NextResponse.json({ success: false, error: 'Forbidden', message: pw.message }, { status: 403 })
    }
    if (body.confirm !== 'RESET') {
      return NextResponse.json(
        { success: false, error: 'Validation failed', message: 'Type RESET to confirm' },
        { status: 400 }
      )
    }

    // A snapshot has to exist, and be recent enough to be worth restoring from.
    const snapshot = await ResetRun.findOne({ status: 'snapshot', archiveDbName: { $ne: null } })
      .sort({ createdAt: -1 })
      .lean()
    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: 'No snapshot', message: 'Take the snapshot and archive first' },
        { status: 409 }
      )
    }
    const age = Date.now() - new Date(snapshot.startedAt).getTime()
    if (age > SNAPSHOT_MAX_AGE_MS) {
      return NextResponse.json(
        {
          success: false,
          error: 'Snapshot stale',
          message: 'That snapshot is more than six hours old. Take a fresh one before running the reset.',
        },
        { status: 409 }
      )
    }

    const preflight = await runPreflight()
    if (!preflight.canProceed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Preflight failed',
          message: `${preflight.blockers} unresolved issue${preflight.blockers === 1 ? '' : 's'} — the reset will not run`,
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
    const createdBy = await resolveCreatedBy(user.id)
    run = await ResetRun.create({
      status: 'previewed',
      startedAt: new Date(),
      snapshotPath: snapshot.snapshotPath,
      archiveDbName: snapshot.archiveDbName,
      sunkLockedAmount: plan.totals.sunkLockedAmount,
      createdBy,
    })

    const result = await executePlan(plan, String(createdBy))

    if (!result.ok) {
      await ResetRun.findByIdAndUpdate(run._id, {
        status: 'failed',
        completedAt: new Date(),
        error: `Verification failed: ${result.verify.failures.slice(0, 5).join('; ')}`,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Verification failed',
          message:
            'The reset did not match its own preview, so nothing was changed. Your live data is untouched.',
          data: { verify: result.verify },
        },
        { status: 422 }
      )
    }

    await ResetRun.findByIdAndUpdate(run._id, {
      status: 'executed',
      completedAt: new Date(),
      carriedLockedAmount: result.carriedLockedAmount,
      notes: `${result.verify.checked} checks passed · ${result.documentsBefore} → ${result.documentsAfter} documents`,
    })

    // Mongoose caches connection state per model; the swap replaced whole
    // collections underneath it, so drop any buffered query plans.
    await mongoose.connection.db?.command({ ping: 1 }).catch(() => undefined)

    return NextResponse.json({
      success: true,
      data: {
        resetRunId: String(run._id),
        verify: result.verify,
        documentsBefore: result.documentsBefore,
        documentsAfter: result.documentsAfter,
        archiveDbName: snapshot.archiveDbName,
        snapshotPath: snapshot.snapshotPath,
        nextBillNumber: plan.counter.nextBillNumber,
        carried: {
          outstanding: plan.totals.outstandingCarried,
          chinaBank: plan.ledgers.chinaBank,
          cash: plan.ledgers.cash,
        },
      },
      message: `Reset complete — ${result.verify.checked} checks passed.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Year reset execute API Error:', err)
    if (run) {
      await ResetRun.findByIdAndUpdate(run._id, {
        status: 'failed',
        completedAt: new Date(),
        error: message,
      }).catch(() => undefined)
    }
    return NextResponse.json({ success: false, error: 'Reset failed', message }, { status: 500 })
  }
}
