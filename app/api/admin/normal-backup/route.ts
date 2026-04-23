import { MongoClient } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
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

  const atlasUri = process.env.ATLAS_URI
  if (!atlasUri) {
    return NextResponse.json(
      {
        success: false,
        error: 'Bad request',
        message: 'ATLAS_URI environment variable is required for backup',
      },
      { status: 400 }
    )
  }

  const localUri = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017'
  const dbName = 'import-export'

  let localClient: MongoClient | null = null
  let atlasClient: MongoClient | null = null

  try {
    localClient = new MongoClient(localUri)
    atlasClient = new MongoClient(atlasUri)

    await localClient.connect()
    await atlasClient.connect()

    const localDb = localClient.db(dbName)
    const atlasDb = atlasClient.db(dbName)

    const collections = await localDb.listCollections().toArray()

    for (const col of collections) {
      const name = col.name
      const localColl = localDb.collection(name)
      const atlasColl = atlasDb.collection(name)

      // eslint-disable-next-line no-await-in-loop
      const docs = await localColl.find({}).toArray()

      // Always clear Atlas collection so it mirrors local, even when local is empty.
      // This prevents stale data remaining in cloud when a collection was truncated locally.
      // eslint-disable-next-line no-await-in-loop
      await atlasColl.deleteMany({})

      if (docs.length === 0) {
        // Skip insert for empty collections; Atlas will now also be empty.
        // eslint-disable-next-line no-continue
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      await atlasColl.insertMany(docs)
    }

    return NextResponse.json({
      success: true,
      message: 'Backup completed',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // eslint-disable-next-line no-console
    console.error('[BACKUP] Normal backup failed:', message)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message,
      },
      { status: 500 }
    )
  } finally {
    if (localClient) {
      await localClient.close()
    }
    if (atlasClient) {
      await atlasClient.close()
    }
  }
}

