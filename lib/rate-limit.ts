// Simple in-memory rate limiter for API routes.
// NOTE: For production, prefer Redis or another shared store.

type HitEntry = {
  count: number
  firstHitAt: number
}

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 10

const hits = new Map<string, HitEntry>()

export function checkRateLimit(ip: string | null | undefined): {
  allowed: boolean
  remaining: number
} {
  const key = ip || 'unknown'
  const now = Date.now()

  const existing = hits.get(key)
  if (!existing) {
    hits.set(key, { count: 1, firstHitAt: now })
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 }
  }

  if (now - existing.firstHitAt > WINDOW_MS) {
    // Window expired – reset
    hits.set(key, { count: 1, firstHitAt: now })
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 }
  }

  const nextCount = existing.count + 1
  existing.count = nextCount
  hits.set(key, existing)

  const remaining = Math.max(0, MAX_ATTEMPTS - nextCount)
  return { allowed: nextCount <= MAX_ATTEMPTS, remaining }
}

