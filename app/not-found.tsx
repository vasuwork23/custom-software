'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. Check the URL or go
          back to the dashboard.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Back to Dashboard</Link>
      </Button>
    </main>
  )
}

