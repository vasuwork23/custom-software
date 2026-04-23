import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface AuthUser {
  id: string
  fullName: string
  email: string
  role: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  hasHydrated: boolean
  setHasHydrated: (value: boolean) => void
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
  setUser: (user: AuthUser) => void
}

const TOKEN_KEY = 'auth_token'
const USER_KEY = 'auth_user'

const safeSessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return null
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // ignore
    }
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setAuth: (user, token) => {
        safeSessionStorage.setItem(TOKEN_KEY, token)
        safeSessionStorage.setItem(USER_KEY, JSON.stringify(user))
        set({ user, token })
      },
      clearAuth: () => {
        safeSessionStorage.removeItem(TOKEN_KEY)
        safeSessionStorage.removeItem(USER_KEY)
        set({ user: null, token: null })
      },
      setUser: (user) => {
        safeSessionStorage.setItem(USER_KEY, JSON.stringify(user))
        set({ user })
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => safeSessionStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true)
        }
      },
    }
  )
)
