import type { InsightLabel, ProductInsight, ReorderStatus } from '@/lib/product-insights'

export type Source = 'china' | 'india'

export type InsightRow = ProductInsight & {
  history: { week: string; score: number | null; label: string }[]
  scoreChange: number | null
  scoreChangeSince: string | null
}

export interface InsightsResponse {
  source: Source
  generatedAt: string
  leadTimeDays: number
  leadTimeAuto: number
  leadTimeMeasured: { days: number; samples: number } | null
  coverDays: number
  includesArchive: string | null
  products: InsightRow[]
}

export const LABELS: Record<InsightLabel, { icon: string; text: string; className: string; hint: string }> = {
  star: { icon: '⭐', text: 'Star', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', hint: 'Score 70+' },
  good: { icon: '✅', text: 'Good', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', hint: 'Score 55–69' },
  watch: { icon: '👀', text: 'Watch', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', hint: 'Score 40–54' },
  bad: { icon: '⚠️', text: 'Bad', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', hint: 'Score below 40' },
  dead: { icon: '💀', text: 'Dead', className: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300', hint: 'In stock, no sale for 90+ days' },
  new: { icon: '🆕', text: 'Low data', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300', hint: 'Not enough sales history to score' },
}

export const REORDER: Record<ReorderStatus, { text: string; className: string }> = {
  now: { text: 'Reorder now', className: 'text-red-600 dark:text-red-400' },
  soon: { text: 'Order soon', className: 'text-amber-600 dark:text-amber-400' },
  ok: { text: 'Stock OK', className: 'text-muted-foreground' },
  overstock: { text: 'Overstock', className: 'text-purple-600 dark:text-purple-400' },
  'no-demand': { text: 'No demand', className: 'text-muted-foreground' },
}

export const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: digits })
