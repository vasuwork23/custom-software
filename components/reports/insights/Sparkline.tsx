/**
 * Tiny single-series line; every point has a hover target with its own label.
 * `max` fixes the scale (e.g. 100 for scores); otherwise it fits the data.
 */
export function Sparkline({
  values,
  titles,
  max,
  width = 96,
  height = 28,
  ariaLabel,
}: {
  values: (number | null)[]
  titles: string[]
  max?: number
  width?: number
  height?: number
  ariaLabel: string
}) {
  if (values.length === 0) return null
  const top = max ?? Math.max(...values.map((v) => v ?? 0), 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const x = (i: number) => (values.length > 1 ? i * step : width / 2)
  const y = (v: number) => height - 3 - (v / top) * (height - 6)
  // Gaps (null) break the line rather than dropping to zero
  const segments: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current.join(' '))
      current = []
    } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  })
  if (current.length) segments.push(current.join(' '))
  const lastIdx = values.length - 1
  const last = values[lastIdx]
  const hit = Math.max(step, 8)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible text-foreground/70" role="img" aria-label={ariaLabel}>
      <line x1={0} x2={width} y1={height - 3} y2={height - 3} className="stroke-border" strokeWidth={1} />
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {last != null && <circle cx={x(lastIdx)} cy={y(last)} r={2.5} fill="currentColor" />}
      {values.map((_, i) => (
        <rect key={i} x={x(i) - hit / 2} y={0} width={hit} height={height} fill="transparent">
          <title>{titles[i]}</title>
        </rect>
      ))}
    </svg>
  )
}

export function weeklyTitles(weekly: number[]): string[] {
  const lastIdx = weekly.length - 1
  return weekly.map((v, i) => {
    const ago = lastIdx - i
    return `${ago === 0 ? 'This week' : `${ago} week${ago > 1 ? 's' : ''} ago`}: ${v} CTN`
  })
}
