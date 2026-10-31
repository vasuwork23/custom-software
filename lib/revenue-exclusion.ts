import type mongoose from 'mongoose'

/**
 * Companies flagged "Exclude from revenue" (e.g. SELF CARRYING (SALES)).
 *
 * By default their sales are left out of Revenue and Cost totals, while their
 * profit still counts in Gross and Net Profit. `?includeExcluded=1` puts them back.
 */
export const INCLUDE_EXCLUDED_PARAM = 'includeExcluded'

export interface RevenueExclusion {
  /** Company ids to leave out of Revenue / Cost — empty when nothing is excluded */
  ids: mongoose.Types.ObjectId[]
  /** All flagged companies, so the page can label its switch (also when included) */
  companies: { id: string; name: string }[]
  included: boolean
}

type CompanyModel = typeof import('@/models/Company').default

export async function loadRevenueExclusion(
  Company: CompanyModel,
  searchParams: URLSearchParams
): Promise<RevenueExclusion> {
  const flagged = (await Company.find({ excludeFromRevenue: true }).select('_id companyName').lean()) as {
    _id: mongoose.Types.ObjectId
    companyName?: string
  }[]
  const included = searchParams.get(INCLUDE_EXCLUDED_PARAM) === '1'
  return {
    ids: included ? [] : flagged.map((c) => c._id),
    companies: flagged.map((c) => ({ id: String(c._id), name: c.companyName ?? '' })),
    included,
  }
}

/**
 * `field`, or 0 for sales of an excluded company. With nothing excluded it returns
 * `field` itself, so the aggregation is exactly what it was before.
 */
export function countedIn(
  field: unknown,
  ids: mongoose.Types.ObjectId[],
  companyField = '$bill.company'
): unknown {
  if (ids.length === 0) return field
  return { $cond: [{ $in: [companyField, ids] }, 0, field] }
}
