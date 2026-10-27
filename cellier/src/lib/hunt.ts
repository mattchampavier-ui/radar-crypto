import type { HuntLot } from './types'

const VERDICT_ORDER = { a_viser: 0, a_surveiller: 1, a_ignorer: 2 } as const

/** Tri par intérêt : verdict, puis score, puis date de vente la plus proche. */
export function sortByInterest(a: HuntLot, b: HuntLot) {
  const va = a.verdict ? VERDICT_ORDER[a.verdict] : 3
  const vb = b.verdict ? VERDICT_ORDER[b.verdict] : 3
  return va - vb || (b.score ?? -1) - (a.score ?? -1) || (a.sale_date ?? '9999').localeCompare(b.sale_date ?? '9999')
}

/** Calibrage (section 6.3) : écart entre prix conseillé et prix réellement adjugé, frais compris. */
export function calibration(lots: HuntLot[], defaultFees: number) {
  const done = lots.filter((l) => l.hammer_price_eur != null && l.max_total_eur != null)
  if (done.length < 10) return { count: done.length, ready: false as const }
  const diffs = done.map((l) => {
    const real = l.hammer_price_eur! * (1 + (l.fees_rate ?? defaultFees))
    return { abs: real - l.max_total_eur!, rel: (real - l.max_total_eur!) / l.max_total_eur! }
  })
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  return {
    count: done.length,
    ready: true as const,
    meanAbs: mean(diffs.map((d) => d.abs)),
    meanRel: mean(diffs.map((d) => d.rel)),
    above: diffs.filter((d) => d.abs > 0).length,
  }
}
