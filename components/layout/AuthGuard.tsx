'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { Loader2 } from 'lucide-react'

const PUBLIC_PATHS = ['/login']

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, token, setUser, clearAuth, hasHydrated } = useAuthStore()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!hasHydrated) return

    if (PUBLIC_PATHS.includes(pathname ?? '')) {
      setChecked(true)
      return
    }

    if (!token) {
      router.replace('/login')
      return
    }

    // We have token: ensure we have user (rehydrate from /me if missing or incomplete)
    if (user?.fullName != null && user?.role != null) {
      setChecked(true)
      return
    }

    let cancelled = false
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (!json?.success || !json?.data) {
          clearAuth()
          router.replace('/login')
          return
        }
        setUser({
          id: json.data.id,
          fullName: json.data.fullName ?? '',
          email: json.data.email ?? '',
          role: json.data.role ?? '',
        })
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth()
          router.replace('/login')
        }
      })
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [pathname, token, user?.fullName, user?.role, setUser, router, clearAuth, hasHydrated])

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!checked && !PUBLIC_PATHS.includes(pathname ?? '')) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return <>{children}</>
}
