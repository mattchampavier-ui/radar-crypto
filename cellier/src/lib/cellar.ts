import { UNCERTAIN_BELOW } from './constants'
import type { CellarData, MarketPrice, Purchase, Shelf, StockLot, Wine } from './types'

export type GardeStatus = 'inconnu' | 'trop_jeune' | 'a_boire' | 'apogee' | 'fin' | 'passe'

export const GARDE_LABEL: Record<GardeStatus, string> = {
  inconnu: 'Fenêtre inconnue',
  trop_jeune: 'Trop jeune',
  a_boire: 'À boire',
  apogee: 'À l’apogée',
  fin: 'À boire vite',
  passe: 'Passé',
}

export function gardeStatus(w: Pick<Wine, 'drink_from' | 'drink_peak' | 'drink_until'>, year = new Date().getFullYear()): GardeStatus {
  if (w.drink_from == null || w.drink_until == null) return 'inconnu'
  if (year < w.drink_from) return 'trop_jeune'
  if (year > w.drink_until) return 'passe'
  if (year >= w.drink_until - 1) return 'fin'
  if (w.drink_peak != null && Math.abs(year - w.drink_peak) <= 1) return 'apogee'
  return 'a_boire'
}

export const inWindow = (w: Wine, year = new Date().getFullYear()) =>
  w.drink_from != null && w.drink_until != null && w.drink_from <= year && year <= w.drink_until

export function wineTitle(w: Pick<Wine, 'producer' | 'cuvee' | 'appellation'>) {
  return w.producer || w.appellation || 'Vin en attente de lecture'
}

export function wineSubtitle(w: Pick<Wine, 'producer' | 'cuvee' | 'appellation'>) {
  const app = w.producer && w.appellation !== w.cuvee ? w.appellation : null
  return [w.cuvee, app].filter(Boolean).join(' · ')
}

export const isUncertain = (w: Wine, field: string) =>
  w.status !== 'enrichi' && w.confidence?.[field] != null && w.confidence[field] < UNCERTAIN_BELOW

export function latestPrices(prices: MarketPrice[]) {
  const m = new Map<string, MarketPrice>()
  for (const p of prices) {
    const cur = m.get(p.wine_id)
    if (!cur || cur.checked_at < p.checked_at) m.set(p.wine_id, p)
  }
  return m
}

/** Une ligne de cave : un vin et tous ses lots de bouteilles, prêts à afficher. */
export interface CellarRow {
  wine: Wine
  lots: StockLot[]
  quantity: number
  shelves: Shelf[]
  price: MarketPrice | undefined
  unitCost: number | null
  thumb: string | null
  garde: GardeStatus
  pending: boolean
}

export function unitCost(purchases: Purchase[]) {
  const q = purchases.reduce((s, p) => s + p.quantity, 0)
  if (!q) return null
  const paid = purchases.reduce((s, p) => s + (p.unit_price_eur ?? 0) * p.quantity + (p.fees_eur ?? 0), 0)
  return paid / q
}

export function buildRows(d: CellarData, includeEmpty = false): CellarRow[] {
  const prices = latestPrices(d.prices)
  const shelvesById = new Map(d.shelves.map((s) => [s.id, s]))
  const lotsByWine = new Map<string, StockLot[]>()
  for (const l of d.stockLots) {
    if (!includeEmpty && l.quantity <= 0) continue
    lotsByWine.set(l.wine_id, [...(lotsByWine.get(l.wine_id) ?? []), l])
  }
  const purchasesByWine = new Map<string, Purchase[]>()
  for (const p of d.purchases) purchasesByWine.set(p.wine_id, [...(purchasesByWine.get(p.wine_id) ?? []), p])
  const year = new Date().getFullYear()
  return d.wines
    .filter((w) => lotsByWine.has(w.id))
    .map((w) => {
      const lots = lotsByWine.get(w.id)!
      const shelves = [...new Set(lots.map((l) => l.shelf_id))]
        .map((id) => (id ? shelvesById.get(id) : undefined))
        .filter((s): s is Shelf => !!s)
        .sort((a, b) => a.shelf_number - b.shelf_number)
      return {
        wine: w,
        lots,
        quantity: lots.reduce((s, l) => s + l.quantity, 0),
        shelves,
        price: prices.get(w.id),
        unitCost: unitCost(purchasesByWine.get(w.id) ?? []),
        thumb: lots.find((l) => l.thumb_path)?.thumb_path ?? lots.find((l) => l.label_photo_paths.length)?.label_photo_paths[0] ?? null,
        garde: gardeStatus(w, year),
        pending: w.status === 'en_attente',
      }
    })
}

export function cellarValue(rows: CellarRow[]) {
  let low = 0, high = 0, paid = 0, priced = 0, bottles = 0
  for (const r of rows) {
    bottles += r.quantity
    if (r.price?.low_eur != null) {
      low += r.price.low_eur * r.quantity
      high += (r.price.high_eur ?? r.price.low_eur) * r.quantity
      priced += r.quantity
    }
    if (r.unitCost != null) paid += r.unitCost * r.quantity
  }
  return { low, high, mid: (low + high) / 2, paid, priced, bottles }
}

/** Bouteilles « à boire maintenant » triées par urgence : fin de fenêtre la plus proche d'abord. */
export function drinkNow(rows: CellarRow[], year = new Date().getFullYear()) {
  return rows
    .filter((r) => inWindow(r.wine, year))
    .sort((a, b) => (a.wine.drink_until ?? 9999) - (b.wine.drink_until ?? 9999) || b.quantity - a.quantity)
}

/** Alertes du mois : entrée dans la fenêtre cette année, dernière année de la fenêtre. */
export function windowAlerts(rows: CellarRow[], year = new Date().getFullYear()) {
  return {
    entering: rows.filter((r) => r.wine.drink_from === year),
    leaving: rows.filter((r) => r.wine.drink_until === year),
    past: rows.filter((r) => r.garde === 'passe'),
  }
}

/** Pour chacune des dix années à venir : bouteilles en fenêtre, cible et manque (section 6.2). */
export function gapByYear(rows: CellarRow[], monthly: number, year = new Date().getFullYear()) {
  const target = Math.round(monthly * 12)
  return Array.from({ length: 10 }, (_, i) => {
    const y = year + i
    const bottles = rows.reduce(
      (s, r) => s + (r.wine.drink_from != null && r.wine.drink_until != null && r.wine.drink_from <= y && y <= r.wine.drink_until ? r.quantity : 0),
      0,
    )
    return { year: y, bottles, target, deficit: Math.max(target - bottles, 0) }
  })
}

export function monthsCovered(rows: CellarRow[], monthly: number) {
  const bottles = rows.reduce((s, r) => s + r.quantity, 0)
  return monthly > 0 ? bottles / monthly : 0
}

export function colorShares(rows: CellarRow[]) {
  const total = rows.reduce((s, r) => s + r.quantity, 0)
  const by: Record<string, number> = {}
  for (const r of rows) {
    const c = r.wine.color ?? 'inconnu'
    by[c] = (by[c] ?? 0) + r.quantity
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, total ? v / total : 0]))
}

/** Prochain passage de la tâche Claude, selon les heures réglées. */
export function nextRun(hours: number[], now = new Date()) {
  const sorted = [...hours].sort((a, b) => a - b)
  for (const h of sorted) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d > now) return d
  }
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(sorted[0] ?? 12, 0, 0, 0)
  return d
}

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function matchesQuery(r: CellarRow, q: string) {
  if (!q.trim()) return true
  const hay = normalize(
    [r.wine.producer, r.wine.cuvee, r.wine.appellation, r.wine.region, r.wine.country, r.wine.vintage, r.wine.classification, ...(r.wine.grapes ?? [])]
      .filter(Boolean)
      .join(' '),
  )
  return normalize(q).split(/\s+/).every((t) => hay.includes(t))
}
