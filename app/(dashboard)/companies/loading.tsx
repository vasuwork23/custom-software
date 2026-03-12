'use client'

import { PageHeader } from '@/components/ui/PageHeader'
import { TableSkeleton } from '@/components/ui/TableSkeleton'

export default function CompaniesLoading() {
  return (
    <div className="space-y-6 p-4">
      <PageHeader title="Companies" description="Loading companies..." />
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}

