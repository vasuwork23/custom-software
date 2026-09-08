'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

// The password is tried on its own once typing pauses, so phones need no
// Enter key. Probes are deduped and never counted as failed logins server-side.
const PROBE_DELAY_MS = 700
const MIN_PROBE_LENGTH = 4

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const inputRef = useRef<HTMLInputElement>(null)
  const triedRef = useRef<Set<string>>(new Set())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = sessionStorage.getItem('auth_token')
    if (!token) return
    try {
      const payload = JSON.parse(atob(token.split('.')[1] ?? ''))
      const isExpired = typeof payload.exp === 'number' ? payload.exp * 1000 < Date.now() : true
      if (isExpired) {
        sessionStorage.removeItem('auth_token')
        sessionStorage.removeItem('auth_user')
        clearAuth()
        return
      }
      router.replace('/')
    } catch {
      sessionStorage.removeItem('auth_token')
      sessionStorage.removeItem('auth_user')
      clearAuth()
    }
  }, [router, clearAuth])

  // The box is invisible, so keep it focused: a tap anywhere types into it and
  // opens the on-screen keyboard on mobile.
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    focus()
    window.addEventListener('pointerdown', focus)
    window.addEventListener('touchend', focus)
    window.addEventListener('keydown', focus)
    return () => {
      window.removeEventListener('pointerdown', focus)
      window.removeEventListener('touchend', focus)
      window.removeEventListener('keydown', focus)
    }
  }, [])

  const attempt = useCallback(
    async (candidate: string, probe: boolean) => {
      if (!candidate) return
      if (probe && triedRef.current.has(candidate)) return
      if (probe) triedRef.current.add(candidate)

      setBusy(true)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: candidate, probe }),
        })
        const json = await res.json()

        // Nothing is shown on a failure. A probe leaves the text alone so it
        // can keep being typed; an explicit submit clears it for a retry.
        if (!json.success) {
          if (!probe) setPassword('')
          return
        }

        setAuth(json.data.user, json.data.token)
        router.push('/')
        router.refresh()
      } catch {
        if (!probe) setPassword('')
      } finally {
        setBusy(false)
      }
    },
    [router, setAuth]
  )

  useEffect(() => {
    if (busy || password.length < MIN_PROBE_LENGTH) return
    if (triedRef.current.has(password)) return
    const timer = setTimeout(() => void attempt(password, true), PROBE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [password, busy, attempt])

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <input
        ref={inputRef}
        type="password"
        autoFocus
        autoComplete="current-password"
        enterKeyHint="go"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void attempt(password, false)
          }
          if (e.key === 'Escape') {
            setPassword('')
          }
        }}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none focus:outline-none focus:ring-0"
      />

      <div className="pointer-events-none flex flex-col items-center gap-2 text-center">
        <span className="text-base" aria-hidden="true">
          🚀
        </span>
        <p className="text-sm text-muted-foreground">Server not found</p>
      </div>
    </main>
  )
}
