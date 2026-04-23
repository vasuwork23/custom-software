'use client'

import { PageHeader } from '@/components/ui/PageHeader'
import { TableSkeleton } from '@/components/ui/TableSkeleton'

export default function DashboardSegmentLoading() {
  return (
    <div className="space-y-6 p-4">
      <PageHeader title="Dashboard" description="Loading dashboard data..." />
      <TableSkeleton rows={6} columns={4} />
    </div>
  )
}

