import { MongoClient } from 'mongodb'
import { env } from '@/lib/env'
import { applyPlan } from '@/lib/year-reset/apply'
import { verifyAgainstPlan, type VerifyResult } from '@/lib/year-reset/verify'
import { liveDbName } from '@/lib/year-reset/snapshot'
import type { ResetPlan } from '@/lib/year-reset/plan'

function serverUri(): string {
  const i = env.MONGODB_URI.lastIndexOf('/')
  const q = env.MONGODB_URI.indexOf('?')
  const base = env.MONGODB_URI.slice(0, i)
  const query = q === -1 ? '' : env.MONGODB_URI.slice(q)
  return base + query
}

export interface ExecuteResult {
  ok: boolean
  verify: VerifyResult
  stagingDb: string
  documentsBefore: number
  documentsAfter: number
  swapped: boolean
}

/**
 * Run the reset without the live database ever holding a half-finished state.
 *
 *   copy live → staging → apply the plan → verify the finished result → swap in
 *
 * If verification fails the staging copy is thrown away and live is untouched,
 * which is the whole reason for working on a copy: this server is standalone,
 * so real transactions are not available to roll back a partial write.
 */
export async function executePlan(plan: ResetPlan, ownerId: string): Promise<ExecuteResult> {
  const live = liveDbName()
  const stagingDb = `${live}-reset-staging`
  const client = new MongoClient(serverUri())
  await client.connect()

  try {
    const source = client.db(live)
    const staging = client.db(stagingDb)

    // ── 1. fresh staging copy ──────────────────────────────────────────
    await staging.dropDatabase()
    const collections = await source.listCollections().toArray()
    let documentsBefore = 0
    for (const c of collections) {
      const docs = await source.collection(c.name).find({}).toArray()
      documentsBefore += docs.length
      await staging.createCollection(c.name).catch(() => undefined)
      if (docs.length > 0) await staging.collection(c.name).insertMany(docs, { ordered: false })
    }

    // ── 2. apply, then prove it ────────────────────────────────────────
    await applyPlan(staging, plan, ownerId)
    const verify = await verifyAgainstPlan(staging, plan)

    if (!verify.passed) {
      // Nothing was touched in live. Drop the copy and report why.
      await staging.dropDatabase().catch(() => undefined)
      return { ok: false, verify, stagingDb, documentsBefore, documentsAfter: 0, swapped: false }
    }

    // ── 3. swap ────────────────────────────────────────────────────────
    // deleteMany + insertMany rather than dropping collections, so the unique
    // indexes (bill number, product name, email) survive the swap.
    const stagingCollections = await staging.listCollections().toArray()
    const stagingNames = new Set(stagingCollections.map((c) => c.name))
    let documentsAfter = 0

    for (const c of stagingCollections) {
      const docs = await staging.collection(c.name).find({}).toArray()
      const target = source.collection(c.name)
      await source.createCollection(c.name).catch(() => undefined)
      await target.deleteMany({})
      if (docs.length > 0) {
        await target.insertMany(docs, { ordered: false })
        documentsAfter += docs.length
      }
    }
    // Anything live has that staging does not is stale by definition.
    for (const c of collections) {
      if (!stagingNames.has(c.name)) await source.collection(c.name).deleteMany({})
    }

    await staging.dropDatabase().catch(() => undefined)

    return { ok: true, verify, stagingDb, documentsBefore, documentsAfter, swapped: true }
  } finally {
    await client.close()
  }
}
