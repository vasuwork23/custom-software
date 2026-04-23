import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import BankAccount from '@/models/BankAccount'
import BankTransaction from '@/models/BankTransaction'

export const dynamic = 'force-dynamic'

export async function GET() {
  await connectDB()
  const account = await BankAccount.findOne({ accountName: 'MAMA GPAY' })
  if (!account) return NextResponse.json({ error: 'not found' })

  const txs = await BankTransaction.find({ bankAccount: account._id }).sort({ transactionDate: 1, createdAt: 1 }).lean()
  let running = 0
  const logs = []
  for (const t of txs) {
    if (t.type === 'credit') running += t.amount
    else running -= t.amount
    running = parseFloat(running.toFixed(2))
    logs.push({
      id: t._id,
      date: t.transactionDate,
      created: t.createdAt,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      calcRunning: running
    })
  }

  return NextResponse.json({
    accountBalance: account.currentBalance,
    calculatedBalance: running,
    logs
  })
}
