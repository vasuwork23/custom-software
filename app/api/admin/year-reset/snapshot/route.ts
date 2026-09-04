import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, resolveCreatedBy } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'
import ResetRun from '@/models/ResetRun'
import { runPreflight } from '@/lib/year-reset/preflight'
import { ArchiveExistsError, createSnapshotAndArchive } from '@/lib/year-reset/snapshot'
import { verifyOwnPassword } from '@/lib/year-reset/verify-password'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Take the two safety copies: a mongodump on disk and a frozen archive database.
 * Nothing in the live database is modified here.
 *
 * Pre-flight is re-run server-side first. Passing it in the browser earlier is
 * not enough — the data can move between looking and acting.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])

  if (error === 'Forbidden') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', message: 'Only Owner can take a reset snapshot' },
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

    const body = await req.json().catch(() => ({}))
    const pw = await verifyOwnPassword(user.id, (body as { password?: unknown }).password)
    if (!pw.ok) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', message: pw.message },
        { status: 403 }
      )
    }

    const preflight = await runPreflight()
    if (!preflight.canProceed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Preflight failed',
          message: `${preflight.blockers} unresolved issue${preflight.blockers === 1 ? '' : 's'} — clear them before taking a snapshot`,
          data: { preflight },
        },
        { status: 409 }
      )
    }

    const startedAt = new Date()
    const createdBy = await resolveCreatedBy(user.id)
    run = await ResetRun.create({ status: 'snapshot', startedAt, createdBy })

    const result = await createSnapshotAndArchive(startedAt)

    await ResetRun.findByIdAndUpdate(run._id, {
      completedAt: new Date(),
      snapshotPath: result.snapshotPath,
      archiveDbName: result.archiveDbName,
      countsBefore: result.countsBefore,
    })

    const totalDocs = Object.values(result.countsBefore).reduce((a, n) => a + n, 0)

    return NextResponse.json({
      success: true,
      data: {
        resetRunId: String(run._id),
        snapshotPath: result.snapshotPath,
        archiveDbName: result.archiveDbName,
        collections: Object.keys(result.countsBefore).length,
        documents: totalDocs,
        countsBefore: result.countsBefore,
      },
      message: `Snapshot and archive complete — ${totalDocs} documents copied twice over.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Year reset snapshot API Error:', err)
    if (run) {
      await ResetRun.findByIdAndUpdate(run._id, {
        status: 'failed',
        completedAt: new Date(),
        error: message,
      }).catch(() => undefined)
    }
    // An existing archive is a refusal to destroy last year's copy, not a fault.
    const status = err instanceof ArchiveExistsError ? 409 : 500
    return NextResponse.json(
      { success: false, error: 'Snapshot failed', message },
      { status }
    )
  }
}

/** Recent runs, newest first — the history of what has been taken. */
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth(req, ['owner'])
  if (error === 'Forbidden') {
    return NextResponse.json(
      { success: false, error: 'Forbidden', message: 'Only Owner can view reset history' },
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
    const runs = await ResetRun.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .select('status startedAt completedAt snapshotPath archiveDbName error notes')
      .lean()
    return NextResponse.json({ success: true, data: { runs } })
  } catch (err) {
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
