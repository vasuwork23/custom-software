/**
 * Client-side API helpers with auth token from session storage.
 */

const TOKEN_KEY = 'auth_token'

function handleUnauthorized() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem('auth-storage')
    window.sessionStorage.removeItem(TOKEN_KEY)
    window.sessionStorage.removeItem('auth_user')
  } catch {
    // ignore
  }
  window.location.href = '/login'
}

export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const directToken = window.sessionStorage.getItem(TOKEN_KEY)
    if (directToken) {
      return { Authorization: `Bearer ${directToken}` }
    }

    const raw = window.sessionStorage.getItem('auth-storage')
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } }
    const token = parsed?.state?.token
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

export async function apiGet<T>(url: string): Promise<{ success: true; data: T } | { success: false; error: string; message: string }> {
  const res = await fetch(url, { headers: { ...authHeaders() } })
  const json = await res.json()
  if (res.status === 401) {
    handleUnauthorized()
    return { success: false, error: 'Unauthorized', message: json.message ?? 'Unauthorized' }
  }
  if (!res.ok) return { success: false, error: json.error ?? 'Error', message: json.message ?? res.statusText }
  return json as { success: true; data: T }
}

export async function apiPost<T>(url: string, body: unknown): Promise<{ success: true; data: T } | { success: false; error: string; message: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (res.status === 401) {
    handleUnauthorized()
    return { success: false, error: 'Unauthorized', message: json.message ?? 'Unauthorized' }
  }
  if (!res.ok) return { success: false, error: json.error ?? 'Error', message: json.message ?? res.statusText }
  return json as { success: true; data: T }
}

export async function apiPut<T>(url: string, body: unknown): Promise<{ success: true; data: T } | { success: false; error: string; message: string }> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (res.status === 401) {
    handleUnauthorized()
    return { success: false, error: 'Unauthorized', message: json.message ?? 'Unauthorized' }
  }
  if (!res.ok) return { success: false, error: json.error ?? 'Error', message: json.message ?? res.statusText }
  return json as { success: true; data: T }
}

export async function apiDelete<T>(url: string): Promise<{ success: true; data: T } | { success: false; error: string; message: string }> {
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  const json = await res.json()
  if (res.status === 401) {
    handleUnauthorized()
    return { success: false, error: 'Unauthorized', message: json.message ?? 'Unauthorized' }
  }
  if (!res.ok) return { success: false, error: json.error ?? 'Error', message: json.message ?? res.statusText }
  return json as { success: true; data: T }
}
