import { dishLabel } from './constants'
import { type CellarRow, inWindow } from './cellar'

export interface TonightQuery {
  dish: string
  occasion: string
  maxPrice: number | null
}

export interface Suggestion {
  row: CellarRow
  score: number
  reasons: string[]
  matched: boolean
}

/** Prix de référence d'une bouteille : prix de marché moyen, sinon prix payé. */
export const bottlePrice = (r: CellarRow) =>
  r.price?.low_eur != null ? (r.price.low_eur + (r.price.high_eur ?? r.price.low_eur)) / 2 : r.unitCost

/**
 * « Quoi ouvrir ce soir » (section 4.5) : sans IA, à partir des fiches déjà enrichies.
 * Garde les bouteilles en fenêtre, privilégie l'accord demandé puis la fin de fenêtre.
 */
export function suggestTonight(rows: CellarRow[], q: TonightQuery, year = new Date().getFullYear(), n = 3): Suggestion[] {
  const candidates = rows.filter((r) => r.quantity > 0 && inWindow(r.wine, year))
  const prices = candidates.map(bottlePrice).filter((p): p is number => p != null).sort((a, b) => a - b)
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null

  const scored = candidates
    .filter((r) => {
      if (q.maxPrice == null) return true
      const p = bottlePrice(r)
      return p == null || p <= q.maxPrice
    })
    .map((r): Suggestion => {
      const w = r.wine
      const reasons: string[] = []
      const matched = !!q.dish && w.pairings.includes(q.dish)
      let score = 0
      if (matched) {
        score += 100
        reasons.push(`Accord ${dishLabel(q.dish).toLowerCase()}`)
      }
      const left = (w.drink_until ?? year) - year
      score += Math.max(0, 40 - left * 10)
      if (left <= 0) reasons.push('Dernière année de sa fenêtre')
      else if (left === 1) reasons.push('Fin de fenêtre l’an prochain')
      else if (w.drink_peak != null && Math.abs(year - w.drink_peak) <= 1) {
        score += 15
        reasons.push('À son apogée')
      } else reasons.push(`À boire jusqu’en ${w.drink_until}`)

      const p = bottlePrice(r)
      if (median != null && p != null) {
        if (q.occasion === 'quotidien' && p <= median) score += 15
        if (q.occasion === 'fete' && p >= median) {
          score += 20
          reasons.push('Une belle bouteille de la cave')
        }
        if (q.occasion === 'amis' && r.quantity >= 2) score += 8
      }
      if (r.quantity >= 3) score += 3 // ménage les dernières bouteilles
      return { row: r, score, reasons, matched }
    })
    .sort((a, b) => b.score - a.score || (a.row.wine.drink_until ?? 0) - (b.row.wine.drink_until ?? 0))

  return scored.slice(0, n)
}
