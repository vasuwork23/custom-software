'use client'

import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent } from '@/components/ui/card'

export default function RootLoading() {
  return (
    <div className="space-y-6 p-4">
      <PageHeader title="Loading..." description="Preparing your dashboard." />
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="space-y-2 pt-4">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-6 w-32 rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

