export const grossProfitPct = (revenue: number, cost: number): number => {
  if (!revenue || revenue === 0) return 0
  const profit = revenue - cost
  return parseFloat(((profit / revenue) * 100).toFixed(2))
}

export const formatPct = (val: number): string => {
  if (!val) return '0%'
  return `${val.toFixed(2)}%`
}

