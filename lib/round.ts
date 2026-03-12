export const DECIMAL_PLACES = 5

export const round = (val: number | string | undefined | null): number => {
  if (val === null || val === undefined || val === '') return 0
  return parseFloat(Number(val).toFixed(DECIMAL_PLACES))
}

export const roundCtn = (val: number): number => round(val)
export const roundRate = (val: number): number => round(val)
export const roundCbm = (val: number): number => round(val)
export const roundCost = (val: number): number => round(val)
export const roundQty = (val: number): number => Math.round(val)

export const displayDecimal = (val: number): string => {
  if (!val) return '0'
  if (Number.isInteger(val)) return val.toString()
  return parseFloat(val.toFixed(DECIMAL_PLACES)).toString()
}

