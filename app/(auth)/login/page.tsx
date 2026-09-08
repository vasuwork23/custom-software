'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  // The box is invisible, so keep it focused: any click or keypress types into it.
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    focus()
    window.addEventListener('pointerdown', focus)
    window.addEventListener('keydown', focus)
    return () => {
      window.removeEventListener('pointerdown', focus)
      window.removeEventListener('keydown', focus)
    }
  }, [])

  async function submit() {
    if (isSubmitting || !password) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json()

      // Nothing is shown on a failure: just clear the box so it can be retyped.
      if (!json.success) {
        setPassword('')
        return
      }

      setAuth(json.data.user, json.data.token)
      router.push('/')
      router.refresh()
    } catch {
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <input
        ref={inputRef}
        type="password"
        autoFocus
        autoComplete="current-password"
        aria-label="Password"
        value={password}
        readOnly={isSubmitting}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
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
