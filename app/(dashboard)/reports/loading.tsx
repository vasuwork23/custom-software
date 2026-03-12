'use client'

import { PageHeader } from '@/components/ui/PageHeader'
import { TableSkeleton } from '@/components/ui/TableSkeleton'

export default function ReportsLoading() {
  return (
    <div className="space-y-6 p-4">
      <PageHeader title="Reports" description="Loading reports..." />
      <TableSkeleton rows={6} columns={5} />
    </div>
  )
}

