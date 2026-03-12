'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log full error details for debugging
    // eslint-disable-next-line no-console
    console.error('Global application error:', error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred while rendering the application.
            You can try again or go back to the dashboard.
          </p>
          <div className="flex gap-3">
            <Button onClick={reset}>Refresh Page</Button>
            <Button variant="outline" asChild>
              <a href="/">Go to Dashboard</a>
            </Button>
          </div>
        </main>
      </body>
    </html>
  )
}

