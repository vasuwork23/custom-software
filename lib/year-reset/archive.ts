import mongoose from 'mongoose'
import { MongoClient } from 'mongodb'
import { env } from '@/lib/env'
import BuyingEntry from '@/models/BuyingEntry'
import Company from '@/models/Company'
import Expense from '@/models/Expense'
import IndiaBuyingEntry from '@/models/IndiaBuyingEntry'
import PaymentReceipt from '@/models/PaymentReceipt'
import SellBill from '@/models/SellBill'
import SellBillItem from '@/models/SellBillItem'
import { liveDbName } from '@/lib/year-reset/snapshot'

/** Archive databases are named after the reset that produced them. */
const ARCHIVE_RE = /-archive-\d{4}-\d{2}-\d{2}$/

export function isArchiveName(name: string): boolean {
  return name.startsWith(`${liveDbName()}-archive-`) && ARCHIVE_RE.test(name)
}

function serverUri(): string {
  const i = env.MONGODB_URI.lastIndexOf('/')
  const q = env.MONGODB_URI.indexOf('?')
  return env.MONGODB_URI.slice(0, i) + (q === -1 ? '' : env.MONGODB_URI.slice(q))
}

export interface ArchiveSummary {
  name: string
  resetDate: string
  sizeOnDisk: number
  sellBills: number
  buyingEntries: number
  companies: number
}

/** Every frozen year on this server, newest first. */
export async function listArchives(): Promise<ArchiveSummary[]> {
  const client = new MongoClient(serverUri())
  await client.connect()
  try {
    const { databases } = await client.db().admin().listDatabases()
    const names = databases.map((d) => d.name).filter(isArchiveName)
    const out: ArchiveSummary[] = []
    for (const name of names) {
      const db = client.db(name)
      const info = databases.find((d) => d.name === name)
      out.push({
        name,
        resetDate: name.slice(-10),
        sizeOnDisk: info?.sizeOnDisk ?? 0,
        sellBills: await db.collection('sellbills').countDocuments().catch(() => 0),
        buyingEntries: await db.collection('buyingentries').countDocuments().catch(() => 0),
        companies: await db.collection('companies').countDocuments().catch(() => 0),
      })
    }
    return out.sort((a, b) => b.resetDate.localeCompare(a.resetDate))
  } finally {
    await client.close()
  }
}

/**
 * Models bound to an archive database, or the live ones when no archive is asked for.
 *
 * Reports read through this so a past year can be opened without restoring it over
 * the top of your current data. Archives are never written to.
 */
export interface ReportModels {
  SellBill: typeof SellBill
  SellBillItem: typeof SellBillItem
  Company: typeof Company
  Expense: typeof Expense
  PaymentReceipt: typeof PaymentReceipt
  BuyingEntry: typeof BuyingEntry
  IndiaBuyingEntry: typeof IndiaBuyingEntry
}

export function reportModels(archiveDb?: string | null): ReportModels {
  if (!archiveDb) {
    return { SellBill, SellBillItem, Company, Expense, PaymentReceipt, BuyingEntry, IndiaBuyingEntry }
  }
  if (!isArchiveName(archiveDb)) {
    throw new Error('That is not an archive database')
  }
  const conn = mongoose.connection.useDb(archiveDb, { useCache: true })
  const bind = (name: string, schema: mongoose.Schema): mongoose.Model<unknown> =>
    conn.models[name] ?? conn.model(name, schema)

  // One cast at the boundary: these are the same schemas, just pointed at a
  // different database, and typing each individually blows up the compiler.
  return {
    SellBill: bind('SellBill', SellBill.schema),
    SellBillItem: bind('SellBillItem', SellBillItem.schema),
    Company: bind('Company', Company.schema),
    Expense: bind('Expense', Expense.schema),
    PaymentReceipt: bind('PaymentReceipt', PaymentReceipt.schema),
    BuyingEntry: bind('BuyingEntry', BuyingEntry.schema),
    IndiaBuyingEntry: bind('IndiaBuyingEntry', IndiaBuyingEntry.schema),
  } as unknown as ReportModels
}
