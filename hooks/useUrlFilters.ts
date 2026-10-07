'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { format, isValid, parse } from 'date-fns'
import type { DateRange } from 'react-day-picker'

/**
 * Keeps list-page filters in the URL query string so they survive navigating
 * into a detail page and pressing the browser back button, or a refresh.
 *
 * Pages read initial values with `useUrlParams()` (inside useState initialisers)
 * and mirror their current filter state back with `useSyncUrlParams()`.
 * Pages using these must be rendered inside a <Suspense> boundary (useSearchParams).
 */

type UrlValue = string | number | null | undefined

const LAST_QUERY_KEY = 'list-query:'
const DATE_FORMAT = 'yyyy-MM-dd'

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const d = parse(value, DATE_FORMAT, new Date())
  return isValid(d) ? d : undefined
}

export function useUrlParams() {
  const searchParams = useSearchParams()
  return useMemo(
    () => ({
      str(key: string, fallback = ''): string {
        return searchParams.get(key) ?? fallback
      },
      int(key: string, fallback: number): number {
        const n = Number(searchParams.get(key))
        return Number.isInteger(n) && n > 0 ? n : fallback
      },
      oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
        const v = searchParams.get(key) as T | null
        return v !== null && allowed.includes(v) ? v : fallback
      },
      bool(key: string, fallback: boolean): boolean {
        const v = searchParams.get(key)
        if (v === '1') return true
        if (v === '0') return false
        return fallback
      },
      dateRange(fromKey = 'from', toKey = 'to'): DateRange | undefined {
        const from = parseDate(searchParams.get(fromKey))
        const to = parseDate(searchParams.get(toKey))
        return from || to ? { from, to } : undefined
      },
    }),
    [searchParams]
  )
}

/** Serialise a date range into `from` / `to` query values. */
export function dateRangeParams(range: DateRange | undefined, fromKey = 'from', toKey = 'to') {
  return {
    [fromKey]: range?.from ? format(range.from, DATE_FORMAT) : undefined,
    [toKey]: range?.to ? format(range.to, DATE_FORMAT) : undefined,
  }
}

/** Serialise a boolean, omitting it from the URL when it equals the default. */
export function boolParam(value: boolean, defaultValue: boolean) {
  return value === defaultValue ? undefined : value ? '1' : '0'
}

/**
 * Mirrors `values` into the URL. Empty values (undefined / null / '') are omitted,
 * so callers should pass undefined for anything at its default.
 * Uses history.replaceState: no history entry per keystroke and no route reload.
 */
export function useSyncUrlParams(values: Record<string, UrlValue>) {
  const pathname = usePathname()
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const query = params.toString()

  useEffect(() => {
    if (query !== window.location.search.replace(/^\?/, '')) {
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname)
    }
    try {
      sessionStorage.setItem(LAST_QUERY_KEY + pathname, query)
    } catch {
      // storage unavailable — breadcrumb links just fall back to the bare path
    }
  }, [query, pathname])
}

/**
 * Href for a list page that restores its last-used filters, for breadcrumb /
 * cancel links on detail pages. Falls back to the bare path until mounted.
 */
export function useListHref(path: string): string {
  const [href, setHref] = useState(path)
  useEffect(() => {
    try {
      const query = sessionStorage.getItem(LAST_QUERY_KEY + path)
      if (query) setHref(`${path}?${query}`)
    } catch {
      // ignore
    }
  }, [path])
  return href
}

/**
 * Runs `onChange` when any of `deps` changes, but not on mount — e.g. resetting
 * to page 1 when filters change without clobbering a page restored from the URL.
 * Compares serialised values, so it is safe under React Strict Mode double effects.
 */
export function useOnFiltersChange(deps: unknown[], onChange: () => void) {
  const key = JSON.stringify(deps)
  const prevKey = useRef(key)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (prevKey.current === key) return
    prevKey.current = key
    onChangeRef.current()
  }, [key])
}
