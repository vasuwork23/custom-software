'use client'

import { useEffect } from 'react'
import { Minimize2 } from 'lucide-react'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isBrowserFullScreen, useUiStore } from '@/store/uiStore'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { fullScreen, exitFullScreen } = useUiStore()

  useEffect(() => {
    if (!fullScreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) exitFullScreen()
    }
    // Esc in browser full screen leaves it without a keydown; follow it out
    const onChange = () => {
      if (!document.fullscreenElement && isBrowserFullScreen()) exitFullScreen()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onChange)
    }
  }, [fullScreen, exitFullScreen])

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Kept mounted while hidden so the header doesn't refetch on exit */}
        <div className={cn('contents', fullScreen && 'hidden')}>
          <Sidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className={cn('contents', fullScreen && 'hidden')}>
            <Header />
          </div>
          <main className={cn('flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6', fullScreen && 'pt-14 md:pt-14')}>
            {children}
          </main>
        </div>
        {fullScreen && (
          <Button
            variant="outline"
            size="sm"
            className="fixed right-4 top-3 z-50 shadow-sm"
            onClick={exitFullScreen}
            title="Exit full screen (Esc)"
          >
            <Minimize2 className="mr-2 h-4 w-4" />
            Exit full screen
          </Button>
        )}
      </div>
    </AuthGuard>
  )
}
