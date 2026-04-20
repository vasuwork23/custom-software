'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { ChinaBankCard } from '@/components/china-bank/ChinaBankCard'
import { TransactionHistory } from '@/components/china-bank/TransactionHistory'
import { AddPaymentDialog } from '@/components/china-bank/AddPaymentDialog'
import { WithdrawDialog } from '@/components/china-bank/WithdrawDialog'
import { apiGet } from '@/lib/api-client'

export default function ChinaBankPage() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [isNegative, setIsNegative] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true)
    const result = await apiGet<{ balance: number; isNegative: boolean }>('/api/china-bank/balance')
    setBalanceLoading(false)
    if (result.success) {
      setBalance(result.data.balance)
      setIsNegative(result.data.isNegative)
    }
  }, [])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance, refreshTrigger])

  function handlePaymentSuccess() {
    setRefreshTrigger((t) => t + 1)
    fetchBalance()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="China Bank"
        description="Manage China bank balance and transaction history."
      />

      <ChinaBankCard
        balance={balance ?? 0}
        isNegative={isNegative}
        onAddPayment={() => setPaymentOpen(true)}
        onTransferOut={() => setWithdrawOpen(true)}
        loading={balanceLoading}
      />

      <AddPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        onSuccess={handlePaymentSuccess}
      />

      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        onSuccess={handlePaymentSuccess}
      />

      <TransactionHistory onRefresh={fetchBalance} refreshTrigger={refreshTrigger} />
    </div>
  )
}
