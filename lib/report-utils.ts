/**
 * Get start and end dates for report period.
 * period: 'week' | 'month' | 'year' — relative to today.
 * startDate/endDate: optional ISO date strings for custom range (override period).
 */
export function getReportDateRange(
  period: string,
  startDate?: string | null,
  endDate?: string | null
): { start: Date; end: Date } {
  const now = new Date()
  if (startDate && endDate) {
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999)
      return { start, end }
    }
  }
  let start: Date
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  switch (period) {
    case 'week': {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0)
      break
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
      break
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  }
  return { start, end }
}

/** MongoDB $dateToString format for grouping by period */
export function getPeriodFormat(period: string): string {
  switch (period) {
    case 'week':
      return '%Y-W%V'
    case 'month':
      return '%Y-%m'
    case 'year':
      return '%Y'
    case 'custom':
      return '%Y-%m-%d'
    default:
      return '%Y-%m-%d'
  }
}
