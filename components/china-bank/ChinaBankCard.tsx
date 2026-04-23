'use client'

import { Landmark } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { Badge } from '@/components/ui/badge'

interface ChinaBankCardProps {
  balance: number
  isNegative: boolean
  onAddPayment: () => void
  onTransferOut: () => void
  loading?: boolean
}

export function ChinaBankCard({
  balance,
  isNegative,
  onAddPayment,
  onTransferOut,
  loading,
}: ChinaBankCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <span className="text-sm font-medium text-muted-foreground">China Bank Balance</span>
        <Landmark className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <span className="text-2xl font-semibold text-muted-foreground">—</span>
          ) : (
            <AmountDisplay amount={balance} className="text-2xl font-semibold" />
          )}
          {isNegative && (
            <Badge variant="destructive">Negative balance</Badge>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={onAddPayment} size="sm">
            Add Payment
          </Button>
          <Button onClick={onTransferOut} size="sm" variant="outline">
            Transfer Out
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
