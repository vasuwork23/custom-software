import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { MongoClient } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { connectDB } from '@/lib/mongodb'

const execAsync = promisify(exec)

// Collections to drop from local after backup
// users NOT in this list — preserved always
// backuplogs NOT in this list — model removed
const COLLECTIONS_TO_DROP = [
  'products',
  'buyingentries',
  'buyingpayments',
  'indiaproducts',
  'indiabuyingentries',
  'indiabuyingpayments',
  'sellbills',
  'sellbillitems',
  'companies',
  'paymentreceipts',
  'bankaccounts',
  'banktransactions',
  'chinabanktransactions',
  'cashtransactions',
  'cashes',
  'containers',
  'counters',
  'liabilities',
  // China people collection name in MongoDB (from ChinaPerson model)
  'chinapeople',
  // Legacy/alternate naming, kept for safety
  'chinapersons',
  'chinapersontransactions',
  'expenses',
]

// Secure permanent delete for macOS
// Bypasses Trash completely — NOT recoverable
const secureDeleteFile = async (filePath: string) => {
  if (!fs.existsSync(filePath)) return

  try {
    const fileSize = fs.statSync(filePath).size
    if (fileSize <= 0) {
      await execAsync(`rm -f "${filePath}"`)
      return
    }

    // Overwrite file contents 3 times with random data
    for (let pass = 0; pass < 3; pass += 1) {
      const garbage = Buffer.alloc(fileSize)
      for (let i = 0; i < fileSize; i += 1) {
        garbage[i] = Math.floor(Math.random() * 256)
      }
      fs.writeFileSync(filePath, garbage)
    }

    // Overwrite with zeros
    fs.writeFileSync(filePath, Buffer.alloc(fileSize, 0))

    // macOS: rm -P overwrites file 3 times before deleting, bypasses Trash
    await execAsync(`rm -P "${filePath}"`)
  } catch {
    // Fallback: normal delete if rm -P fails
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore
    }
  }
}

const secureDeleteFolder = async (folderPath: string) => {
  if (!fs.existsSync(folderPath)) return
  try {
    // Delete folder and all contents permanently (bypasses Trash on macOS)
    await execAsync(`rm -rf "${folderPath}"`)
  } catch {
    // ignore
  }
}

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
  const localUri = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017'
  const dbName = 'import-export'
  const envPath = path.join(process.cwd(), '.env.local')
  const scriptPath = path.join(process.cwd(), 'scripts', 'migrate-to-atlas.js')
  const scriptsDir = path.join(process.cwd(), 'scripts')

  if (!atlasUri) {
    return NextResponse.json(
      {
        success: false,
        error: 'Bad request',
        message: 'ATLAS_URI environment variable is required for cloud backup',
      },
      { status: 400 }
    )
  }

  let localClient: MongoClient | null = null
  let atlasClient: MongoClient | null = null

  try {
    // ============================================
    // STEP 1: Connect to both databases
    // ============================================
    localClient = new MongoClient(localUri)
    atlasClient = new MongoClient(atlasUri)
    await localClient.connect()
    await atlasClient.connect()

    const localDb = localClient.db(dbName)
    const atlasDb = atlasClient.db(dbName)

    // ============================================
    // STEP 2: Copy ALL collections to Atlas
    // ============================================
    const allCollections = await localDb.listCollections().toArray()

    for (const col of allCollections) {
      const name = col.name
      const localCol = localDb.collection(name)
      const atlasCol = atlasDb.collection(name)

      const docs = await localCol.find({}).toArray()
      if (docs.length === 0) continue

      await atlasCol.deleteMany({})
      await atlasCol.insertMany(docs)
    }

    // ============================================
    // STEP 3: Drop local collections except users
    // ============================================
    for (const colName of COLLECTIONS_TO_DROP) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await localDb.collection(colName).drop()
      } catch {
        // Collection may not exist — ignore
      }
    }
    // Explicitly drop legacy backuplogs collection if it exists
    await localDb
      .collection('backuplogs')
      .drop()
      .catch(() => {})

    // ============================================
    // STEP 4: Secure delete script file and scripts folder (macOS-focused)
    // ============================================
    await secureDeleteFile(scriptPath)
    await secureDeleteFolder(scriptsDir)

    // Clear any bash/zsh history entries that might contain Atlas URI or script path
    try {
      await execAsync(`
        if [ -f ~/.zsh_history ]; then
          sed -i '' '/atlas/Id' ~/.zsh_history || true
          sed -i '' '/mongodb+srv/Id' ~/.zsh_history || true
          sed -i '' '/migrate-to-atlas/Id' ~/.zsh_history || true
        fi
        if [ -f ~/.bash_history ]; then
          sed -i '' '/atlas/Id' ~/.bash_history || true
          sed -i '' '/mongodb+srv/Id' ~/.bash_history || true
          sed -i '' '/migrate-to-atlas/Id' ~/.bash_history || true
        fi
      `)
    } catch {
      // ignore
    }

    // ============================================
    // STEP 5: Remove ATLAS_URI from .env.local
    // No trace of Atlas URL in any file
    // ============================================
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8')
      envContent = envContent
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('ATLAS_URI=') &&
            !line.includes('mongodb+srv') &&
            !line.includes('atlas')
        )
        .join('\n')
      fs.writeFileSync(envPath, envContent)
    }

    // Clear additional macOS metadata / recent items that might reference scripts folder
    try {
      await execAsync(`
        mdutil -i off "${scriptsDir}" 2>/dev/null || true
        osascript -e 'tell application "Finder" to set recent applications list to {}' 2>/dev/null || true
      `)
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // eslint-disable-next-line no-console
    console.error('[SYSTEM] Cloud backup task failed:', message)

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

