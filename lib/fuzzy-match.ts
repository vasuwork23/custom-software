/**
 * Fuzzy matching of free-text names (from pasted messages) to catalog records.
 * Pure local string similarity — no external services or API keys.
 */

export type MatchConfidence = 'exact' | 'high' | 'medium' | 'low'

export interface MatchCandidate<T> {
  item: T
  score: number
  confidence: MatchConfidence
}

export interface MatchOutcome<T> {
  best: MatchCandidate<T> | null
  alternatives: MatchCandidate<T>[]
  /** Top two candidates scored too close to call — the caller must confirm. */
  ambiguous: boolean
}

/**
 * Score gap below which two candidates are treated as indistinguishable.
 * Catalogues carry colour/size variants ("KNIFE (BLACK)" vs "KNIFE (GREEN)")
 * that a bare "knife" matches equally well; auto-picking one would silently
 * bill the wrong product.
 */
const AMBIGUITY_GAP = 0.05

// Unit abbreviations that vary between what people type and what the catalog holds.
const UNIT_ALIASES: Record<string, string> = {
  ltr: 'l', lt: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  gms: 'g', gm: 'g', gram: 'g', grams: 'g',
  mtr: 'm', meter: 'm', metre: 'm', meters: 'm', metres: 'm',
  watt: 'w', watts: 'w',
  mm: 'mm', ml: 'ml',
}

// Filler words that carry no identifying signal. "in" is deliberately kept
// so product names like "14 in 1" stay intact.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'with', 'and'])

/**
 * Lowercases, splits digit/letter boundaries ("27L" -> "27 l"), normalises unit
 * spellings and strips punctuation. Applied to both sides so the two always
 * agree, even where the split looks odd on its own ("h2o" -> "h 2 o").
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => UNIT_ALIASES[t] ?? t)
    .join(' ')
    .trim()
}

export function tokenize(input: string): string[] {
  return normalize(input)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
}

/** Sørensen–Dice coefficient over character bigrams — tolerant of typos. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2)
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1)
  }
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2)
    const count = bigrams.get(bg) ?? 0
    if (count > 0) {
      bigrams.set(bg, count - 1)
      hits++
    }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

/** How well one query token matches any single candidate token. */
function bestTokenScore(queryToken: string, candidateTokens: string[]): number {
  let best = 0
  for (const ct of candidateTokens) {
    if (ct === queryToken) return 1
    let s = 0
    // Abbreviation: "veg" -> "vegetable", "cut" -> "cutter"
    if (queryToken.length >= 3 && ct.startsWith(queryToken)) s = 0.92
    else if (ct.length >= 3 && queryToken.startsWith(ct)) s = 0.88
    else {
      const d = diceCoefficient(queryToken, ct)
      if (d >= 0.6) s = d * 0.85
    }
    if (s > best) best = s
  }
  return best
}

function toConfidence(score: number): MatchConfidence {
  if (score >= 0.995) return 'exact'
  if (score >= 0.88) return 'high'
  if (score >= 0.68) return 'medium'
  return 'low'
}

/** Similarity of a free-text query against one candidate name, 0..1. */
export function similarity(query: string, candidate: string): number {
  const nq = normalize(query)
  const nc = normalize(candidate)
  if (!nq || !nc) return 0
  if (nq === nc) return 1

  const qTokens = tokenize(query)
  const cTokens = tokenize(candidate)
  if (!qTokens.length || !cTokens.length) return 0

  // Average how well each query token is represented in the candidate.
  let sum = 0
  const matchedCandidates = new Set<string>()
  for (const qt of qTokens) {
    const s = bestTokenScore(qt, cTokens)
    sum += s
    if (s >= 0.6) {
      for (const ct of cTokens) {
        if (ct === qt || ct.startsWith(qt) || qt.startsWith(ct)) matchedCandidates.add(ct)
      }
    }
  }
  const tokenScore = sum / qTokens.length

  // Penalise candidates carrying many extra unrelated words.
  const coverage = matchedCandidates.size / cTokens.length
  const structured = tokenScore * (0.82 + 0.18 * coverage)

  // Whole-string similarity acts as a floor for transposed/typo'd names.
  const floor = diceCoefficient(nq, nc) * 0.9

  return Math.min(1, Math.max(structured, floor))
}

/**
 * Ranks candidates against a query. `getName` may return several aliases for an
 * item (e.g. product name plus previously-confirmed spellings); the best wins.
 */
export function matchOne<T>(
  query: string,
  candidates: T[],
  getNames: (item: T) => string[],
  opts: { minScore?: number; maxAlternatives?: number } = {}
): MatchOutcome<T> {
  const minScore = opts.minScore ?? 0.42
  const maxAlternatives = opts.maxAlternatives ?? 4

  if (!query.trim() || !candidates.length) {
    return { best: null, alternatives: [], ambiguous: false }
  }

  const scored: MatchCandidate<T>[] = []
  for (const item of candidates) {
    let score = 0
    for (const name of getNames(item)) {
      const s = similarity(query, name)
      if (s > score) score = s
    }
    if (score >= minScore) scored.push({ item, score, confidence: toConfidence(score) })
  }

  scored.sort((a, b) => b.score - a.score)
  if (!scored.length) return { best: null, alternatives: [], ambiguous: false }

  const [top, ...rest] = scored
  const ambiguous = rest.length > 0 && top.score - rest[0].score < AMBIGUITY_GAP

  // An ambiguous winner is never presented as confident.
  const best: MatchCandidate<T> = ambiguous ? { ...top, confidence: 'low' } : top

  return { best, alternatives: rest.slice(0, maxAlternatives), ambiguous }
}
