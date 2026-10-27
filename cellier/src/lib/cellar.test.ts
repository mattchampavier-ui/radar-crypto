import { describe, expect, it } from 'vitest'
import { buildRows, cellarValue, drinkNow, gapByYear, gardeStatus, nextRun } from './cellar'
import { suggestTonight } from './tonight'
import { DEFAULT_SETTINGS } from './constants'
import type { CellarData, Wine } from './types'

const wine = (id: string, p: Partial<Wine>): Wine => ({
  id, producer: id, cuvee: null, appellation: null, region: null, country: null, vintage: 2018, color: 'rouge',
  grapes: [], bottle_size_cl: 75, classification: null, drink_from: null, drink_peak: null, drink_until: null,
  serving_temp_c: null, decant_min: null, pairings: [], confidence: {}, sources: [], notes: null,
  merge_candidate_id: null, status: 'enrichi', created_at: '', updated_at: '', ...p,
})

const data = (wines: Wine[], qty: Record<string, number>): CellarData => ({
  settings: DEFAULT_SETTINGS, shelves: [{ id: 's1', shelf_number: 1, label: null, capacity: 20 }], wines,
  prices: [{ id: 'p', wine_id: 'a', low_eur: 20, high_eur: 30, confidence: 0.8, sources: [], checked_at: '2026-01-01' }],
  stockLots: Object.entries(qty).map(([w, q]) => ({
    id: 'l' + w, wine_id: w, shelf_id: 's1', quantity: q, label_photo_paths: [], thumb_path: null, fill_level: null,
    label_condition: null, capsule_cork_condition: null, provenance: null, added_at: '',
  })),
  purchases: [], movements: [], tastings: [], huntLots: [], huntLotWines: [], jobs: [], snapshots: [], loadedAt: '',
})

describe('garde', () => {
  it('classe selon l’année', () => {
    expect(gardeStatus({ drink_from: 2028, drink_peak: null, drink_until: 2035 }, 2026)).toBe('trop_jeune')
    expect(gardeStatus({ drink_from: 2020, drink_peak: 2026, drink_until: 2032 }, 2026)).toBe('apogee')
    expect(gardeStatus({ drink_from: 2020, drink_peak: null, drink_until: 2026 }, 2026)).toBe('fin')
    expect(gardeStatus({ drink_from: 2010, drink_peak: null, drink_until: 2020 }, 2026)).toBe('passe')
    expect(gardeStatus({ drink_from: null, drink_peak: null, drink_until: null }, 2026)).toBe('inconnu')
  })
})

describe('cave', () => {
  const d = data(
    [
      wine('a', { drink_from: 2020, drink_until: 2026, pairings: ['fromage'] }),
      wine('b', { drink_from: 2022, drink_until: 2034, pairings: ['viande_rouge'] }),
      wine('c', { drink_from: 2030, drink_until: 2040, pairings: ['viande_rouge'] }),
      wine('d', { drink_from: 2020, drink_until: 2030 }),
    ],
    { a: 2, b: 6, c: 6, d: 0 },
  )
  const rows = buildRows(d)

  it('ignore les lots vides et valorise la cave', () => {
    expect(rows.map((r) => r.wine.id).sort()).toEqual(['a', 'b', 'c'])
    expect(cellarValue(rows).low).toBe(40)
  })

  it('trie « à boire maintenant » par fin de fenêtre', () => {
    expect(drinkNow(rows, 2026).map((r) => r.wine.id)).toEqual(['a', 'b'])
  })

  it('calcule le manque par année', () => {
    const g = gapByYear(rows, 6, 2026)
    expect(g[0]).toEqual({ year: 2026, bottles: 8, target: 72, deficit: 64 })
    expect(g[4].bottles).toBe(12)
  })

  it('propose d’abord l’accord, puis la fin de fenêtre, jamais hors fenêtre', () => {
    const s = suggestTonight(rows, { dish: 'viande_rouge', occasion: 'quotidien', maxPrice: null }, 2026)
    expect(s[0].row.wine.id).toBe('b')
    expect(s.map((x) => x.row.wine.id)).not.toContain('c')
    const f = suggestTonight(rows, { dish: 'fromage', occasion: 'quotidien', maxPrice: null }, 2026)
    expect(f[0].row.wine.id).toBe('a')
    expect(f[0].reasons[0]).toMatch(/fromage/)
  })

  it('respecte le plafond de prix', () => {
    const s = suggestTonight(rows, { dish: 'fromage', occasion: 'quotidien', maxPrice: 10 }, 2026)
    expect(s.map((x) => x.row.wine.id)).toEqual(['b'])
  })

  it('calcule le prochain passage', () => {
    expect(nextRun([12, 20], new Date(2026, 9, 27, 13)).getHours()).toBe(20)
    expect(nextRun([12, 20], new Date(2026, 9, 27, 21)).getDate()).toBe(28)
  })
})
