import { exec } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { MongoClient } from 'mongodb'
import { env } from '@/lib/env'

const execAsync = promisify(exec)

/** Refusing to overwrite an existing archive is a rule, not a crash. */
export class ArchiveExistsError extends Error {
  constructor(name: string) {
    super(
      `An archive named "${name}" already exists. Rename or drop it first — overwriting it would destroy an earlier year.`
    )
    this.name = 'ArchiveExistsError'
  }
}

/** Where mongodump folders live. restore.sh reads the same default. */
export function backupRoot(): string {
  return process.env.BACKUP_ROOT || path.join(os.homedir(), 'import-export-backups')
}

/** The database the app runs against, taken from the connection string. */
export function liveDbName(): string {
  const fromUri = new URL(env.MONGODB_URI.replace(/^mongodb\+srv:\/\//, 'mongodb://'))
    .pathname.replace(/^\//, '')
    .split('?')[0]
  return fromUri || 'import-export'
}

function serverUri(): string {
  // Strip the database off the end so we can address sibling databases.
  const i = env.MONGODB_URI.lastIndexOf('/')
  const q = env.MONGODB_URI.indexOf('?')
  const base = q === -1 ? env.MONGODB_URI.slice(0, i) : env.MONGODB_URI.slice(0, i)
  const query = q === -1 ? '' : env.MONGODB_URI.slice(q)
  return base + query
}

/**
 * Find mongodump. Next inherits whatever PATH launched it, which on macOS often
 * misses ~/.local/bin, so fall back to the usual install locations before giving up.
 */
async function resolveMongodump(): Promise<string> {
  const candidates = [
    process.env.MONGODUMP_PATH,
    'mongodump',
    path.join(os.homedir(), '.local/bin/mongodump'),
    '/opt/homebrew/bin/mongodump',
    '/usr/local/bin/mongodump',
  ].filter(Boolean) as string[]

  for (const c of candidates) {
    try {
      await execAsync(`"${c}" --version`)
      return c
    } catch {
      // try the next one
    }
  }
  throw new Error(
    'mongodump was not found. Install the MongoDB Database Tools, or set MONGODUMP_PATH in .env.local'
  )
}

export interface SnapshotResult {
  snapshotPath: string
  archiveDbName: string
  countsBefore: Record<string, number>
}

/** Timestamped folder name — dated, with a time so two runs in a day never collide. */
function stamp(at: Date): { day: string; folder: string } {
  const p = (n: number) => String(n).padStart(2, '0')
  const day = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
  return { day, folder: `${day}_${p(at.getHours())}${p(at.getMinutes())}` }
}

/**
 * Take both safety copies before anything is changed:
 *   1. a mongodump on disk, which restore.sh can put back wholesale
 *   2. a frozen sibling database, so the old year stays queryable
 *
 * Refuses to overwrite an existing archive — that would destroy a previous year.
 */
export async function createSnapshotAndArchive(at: Date = new Date()): Promise<SnapshotResult> {
  const db = liveDbName()
  const { day, folder } = stamp(at)
  const root = backupRoot()
  const snapshotPath = path.join(root, folder)
  const archiveDbName = `${db}-archive-${day}`

  const client = new MongoClient(serverUri())
  await client.connect()
  try {
    const admin = client.db().admin()
    const existing = await admin.listDatabases()
    const clash = existing.databases.find((d) => d.name === archiveDbName)
    if (clash && clash.sizeOnDisk && clash.sizeOnDisk > 0) {
      throw new ArchiveExistsError(archiveDbName)
    }

    // 1. mongodump to disk
    fs.mkdirSync(root, { recursive: true })
    const bin = await resolveMongodump()
    await execAsync(
      `"${bin}" --uri="${env.MONGODB_URI}" --out="${snapshotPath}" --quiet`,
      { maxBuffer: 32 * 1024 * 1024 }
    )
    if (!fs.existsSync(path.join(snapshotPath, db))) {
      throw new Error(`mongodump produced no data at ${snapshotPath}`)
    }

    // 2. clone every collection into the archive database
    const source = client.db(db)
    const target = client.db(archiveDbName)
    const collections = await source.listCollections().toArray()
    const countsBefore: Record<string, number> = {}

    for (const c of collections) {
      const from = source.collection(c.name)
      const docs = await from.find({}).toArray()
      countsBefore[c.name] = docs.length
      // Create the collection even when empty, so the archive mirrors the shape.
      await target.createCollection(c.name).catch(() => undefined)
      if (docs.length > 0) {
        await target.collection(c.name).insertMany(docs, { ordered: false })
      }
    }

    // 3. prove the archive matches before calling it done
    const mismatches: string[] = []
    for (const [name, n] of Object.entries(countsBefore)) {
      const got = await target.collection(name).countDocuments()
      if (got !== n) mismatches.push(`${name}: expected ${n}, archived ${got}`)
    }
    if (mismatches.length > 0) {
      throw new Error(`Archive verification failed — ${mismatches.join('; ')}`)
    }

    return { snapshotPath, archiveDbName, countsBefore }
  } finally {
    await client.close()
  }
}
