import type { Api } from './api'
import { DEFAULT_SETTINGS } from './constants'
import { blobToDataUrl } from './image'
import type { CellarData, HuntLot, HuntLotWine, MarketPrice, StockLot, Wine } from './types'

/** Mode démo : mêmes écrans, données fictives gardées dans ce navigateur. Aucune IA. */
const KEY = 'cellier.demo.v1'
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const Y = new Date().getFullYear()
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

function seed(): CellarData {
  const shelves = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `s${n}`, shelf_number: n, label: n === 1 ? 'Haut — blancs' : n === 6 ? 'Bas — garde' : null, capacity: 36 }))
  const base = (p: Partial<Wine>): Wine => ({
    id: uid(), producer: null, cuvee: null, appellation: null, region: null, country: 'France', vintage: null, color: 'rouge',
    grapes: [], bottle_size_cl: 75, classification: null, drink_from: null, drink_peak: null, drink_until: null,
    serving_temp_c: 16, decant_min: null, pairings: [], confidence: {}, sources: [], notes: null, merge_candidate_id: null,
    status: 'enrichi', created_at: now(), updated_at: now(), ...p,
  })
  const W: [Partial<Wine>, number, string, number, number, number][] = [
    [{ producer: 'Domaine Jamet', appellation: 'Côte-Rôtie', region: 'Rhône', vintage: 2015, grapes: ['Syrah'], drink_from: Y - 3, drink_peak: Y, drink_until: Y + 8, decant_min: 60, pairings: ['viande_rouge', 'gibier'] }, 3, 's6', 95, 120, 85],
    [{ producer: 'Domaine Jean-Louis Chave', cuvee: 'Mon Cœur', appellation: 'Côtes du Rhône', region: 'Rhône', vintage: 2020, grapes: ['Syrah', 'Grenache'], drink_from: Y - 3, drink_until: Y + 2, pairings: ['viande_rouge', 'charcuterie', 'volaille'] }, 6, 's4', 18, 24, 17],
    [{ producer: 'Domaine Rolet', appellation: 'Arbois', cuvee: 'Vin jaune', region: 'Jura', vintage: 2012, color: 'blanc', grapes: ['Savagnin'], drink_from: Y - 6, drink_until: Y + 25, serving_temp_c: 14, pairings: ['fromage', 'volaille'] }, 2, 's1', 38, 48, 35],
    [{ producer: 'Domaine Leflaive', cuvee: 'Mâcon-Verzé', appellation: 'Mâcon-Verzé', region: 'Bourgogne', vintage: 2021, color: 'blanc', grapes: ['Chardonnay'], drink_from: Y - 3, drink_until: Y, serving_temp_c: 11, pairings: ['poisson', 'fruits_de_mer', 'aperitif'] }, 4, 's1', 32, 40, 30],
    [{ producer: 'Domaine Dujac', appellation: 'Morey-Saint-Denis', region: 'Bourgogne', vintage: 2017, grapes: ['Pinot noir'], drink_from: Y - 2, drink_peak: Y + 2, drink_until: Y + 9, pairings: ['volaille', 'viande_blanche', 'gibier'] }, 2, 's5', 90, 115, 80],
    [{ producer: 'Château de Pibarnon', appellation: 'Bandol', region: 'Provence', vintage: 2016, grapes: ['Mourvèdre'], drink_from: Y + 1, drink_until: Y + 14, decant_min: 90, pairings: ['viande_rouge', 'gibier'] }, 6, 's6', 35, 45, 30],
    [{ producer: 'Domaine des Baumard', cuvee: 'Clos Sainte Catherine', appellation: 'Coteaux du Layon', region: 'Loire', vintage: 2010, color: 'liquoreux', grapes: ['Chenin'], drink_from: Y - 8, drink_until: Y + 10, serving_temp_c: 9, pairings: ['dessert', 'fromage'] }, 2, 's2', 30, 40, 25],
    [{ producer: 'Bérêche et Fils', cuvee: 'Brut Réserve', appellation: 'Champagne', region: 'Champagne', vintage: null, color: 'effervescent', grapes: ['Chardonnay', 'Pinot noir', 'Meunier'], drink_from: Y - 1, drink_until: Y + 3, serving_temp_c: 8, pairings: ['aperitif', 'fruits_de_mer'] }, 6, 's2', 42, 50, 38],
    [{ producer: 'Domaine Tempier', appellation: 'Bandol', color: 'rose', region: 'Provence', vintage: Y - 2, grapes: ['Mourvèdre', 'Cinsault'], drink_from: Y - 1, drink_until: Y + 1, serving_temp_c: 10, pairings: ['poisson', 'plat_epice', 'aperitif'] }, 3, 's3', 30, 36, 28],
    [{ producer: 'Domaine Gonon', appellation: 'Saint-Joseph', region: 'Rhône', vintage: 2019, grapes: ['Syrah'], drink_from: Y + 2, drink_until: Y + 12, pairings: ['viande_rouge'] }, 6, 's5', 50, 65, 42],
    [{ producer: 'Domaine Ganevat', cuvee: 'Les Chalasses', appellation: 'Côtes du Jura', region: 'Jura', vintage: 2018, color: 'blanc', grapes: ['Chardonnay'], drink_from: Y - 2, drink_until: Y + 6, serving_temp_c: 12, pairings: ['poisson', 'fromage', 'volaille'], status: 'a_verifier', confidence: { cuvee: 0.4, vintage: 0.5, producer: 0.95 } }, 1, 's1', 70, 95, 65],
    [{ producer: 'Château Rayas', cuvee: 'Pignan', appellation: 'Châteauneuf-du-Pape', region: 'Rhône', vintage: 2009, grapes: ['Grenache'], drink_from: Y - 10, drink_until: Y - 1, pairings: ['viande_rouge'] }, 1, 's6', 150, 190, 120],
  ]
  const wines: Wine[] = [], prices: MarketPrice[] = [], stockLots: StockLot[] = []
  const purchases: CellarData['purchases'] = []
  for (const [w, qty, shelf, lo, hi, paid] of W) {
    const wine = base(w)
    wines.push(wine)
    prices.push({ id: uid(), wine_id: wine.id, low_eur: lo, high_eur: hi, confidence: 0.75, checked_at: now(),
      sources: [{ url: 'https://www.idealwine.com/fr/', label: 'iDealwine (cote)', checked_at: inDays(-10) }] })
    const lot: StockLot = { id: uid(), wine_id: wine.id, shelf_id: shelf, quantity: qty, label_photo_paths: [], thumb_path: null,
      fill_level: 'goulot', label_condition: 'Bon état', capsule_cork_condition: null, provenance: 'Cave personnelle', added_at: now() }
    stockLots.push(lot)
    purchases.push({ id: uid(), wine_id: wine.id, stock_lot_id: lot.id, date: inDays(-200), quantity: qty, unit_price_eur: paid, fees_eur: 0, source: 'caviste', hunt_lot_id: null })
  }
  const pending = base({ status: 'en_attente', color: null, country: null, serving_temp_c: null })
  wines.push(pending)
  stockLots.push({ id: uid(), wine_id: pending.id, shelf_id: 's3', quantity: 2, label_photo_paths: [], thumb_path: null, fill_level: null,
    label_condition: null, capsule_cork_condition: null, provenance: null, added_at: now() })

  const tastings = [
    { id: uid(), wine_id: wines[0].id, movement_id: null, date: inDays(-20), score_20: 17.5, notes: 'Olive noire, violette, fumé. Tannins fondus.', occasion: 'amis', dish_type: 'viande_rouge' },
    { id: uid(), wine_id: wines[1].id, movement_id: null, date: inDays(-45), score_20: 15, notes: 'Fruit croquant, parfait pour un mardi.', occasion: 'quotidien', dish_type: 'charcuterie' },
  ]

  const lot = (p: Partial<HuntLot>): HuntLot => ({
    id: uid(), source: 'lien', url: null, sale_house: null, sale_date: null, pickup_date: null, location: null, lot_number: null,
    title: null, description: null, photos: [], provenance: null, estimate_low_eur: null, estimate_high_eur: null, fees_rate: null,
    max_bid_eur: null, max_total_eur: null, score: null, score_detail: {}, verdict: null, reason: null, gap_filled: null,
    hammer_price_eur: null, status: 'nouveau', created_at: now(), ...p,
  })
  const hl = [
    lot({ url: 'https://www.interencheres.com/vins-spiritueux/', sale_house: 'De Baecque et Associés', sale_date: inDays(5), pickup_date: inDays(8), location: 'Lyon (69)', lot_number: '124',
      title: '6 bouteilles Saint-Joseph, Gonon 2017', description: 'Niveaux dans le col, étiquettes légèrement tachées. Provenance : cave d’un amateur lyonnais.', provenance: 'Cave d’un amateur',
      estimate_low_eur: 180, estimate_high_eur: 240, max_bid_eur: 240, max_total_eur: 300, score: 78, verdict: 'a_viser',
      score_detail: { discount: 34, gap: 28, affinity: 6, info: 10, cost: 225, market_low: 300, market_high: 390, confidence: 0.8, fees_rate: 0.25, bottles: 6, eliminated: [] },
      reason: 'Coût probable 225 € pour un marché de 300–390 € (-35 %) · Comble des années en manque : ' + [Y + 2, Y + 3, Y + 4].join(', '), gap_filled: [Y + 2, Y + 3, Y + 4].join(', ') }),
    lot({ url: 'https://www.interencheres.com/vins-spiritueux/', sale_house: 'Hôtel des ventes de Beaune', sale_date: inDays(12), pickup_date: inDays(15), location: 'Beaune (21)', lot_number: '57',
      title: '12 bouteilles Bourgogne rouge, divers', description: 'Lot panaché, niveaux non précisés.', estimate_low_eur: 300, estimate_high_eur: 400,
      max_bid_eur: 336, max_total_eur: 420, score: 52, verdict: 'a_surveiller',
      score_detail: { discount: 12, gap: 30, affinity: 6, info: 3, cost: 375, market_low: 420, market_high: 560, confidence: 0.5, fees_rate: 0.25, bottles: 12, eliminated: [] },
      reason: 'Coût probable 375 € pour un marché de 420–560 € (-23 %) · Comble des années en manque : ' + [Y, Y + 1].join(', '), gap_filled: [Y, Y + 1].join(', ') }),
    lot({ url: 'https://www.leboncoin.fr/', source: 'leboncoin', sale_house: 'Leboncoin', location: 'Bordeaux (33)', title: 'Cave de 24 bouteilles Bordeaux', estimate_low_eur: 900, estimate_high_eur: 900, fees_rate: 0,
      score: 20, verdict: 'a_ignorer', score_detail: { eliminated: ['Retrait à Bordeaux (33), hors zone'] }, reason: 'Retrait à Bordeaux (33), hors zone' }),
  ]
  const hw = (p: Partial<HuntLotWine>): HuntLotWine => ({
    id: uid(), hunt_lot_id: '', producer: null, cuvee: null, appellation: null, region: null, vintage: null, color: 'rouge', bottle_size_cl: 75,
    quantity: 1, fill_level: null, condition_notes: null, cork_rising: false, drink_from: null, drink_until: null, market_low_eur: null,
    market_high_eur: null, market_confidence: null, market_sources: [], wine_id: null, ...p,
  })
  const huntLotWines = [
    hw({ hunt_lot_id: hl[0].id, producer: 'Domaine Gonon', appellation: 'Saint-Joseph', region: 'Rhône', vintage: 2017, quantity: 6, fill_level: 'goulot', condition_notes: 'Étiquettes tachées',
      drink_from: Y - 1, drink_until: Y + 9, market_low_eur: 50, market_high_eur: 65, market_confidence: 0.8, market_sources: [{ url: 'https://www.idealwine.com/fr/', label: 'iDealwine', checked_at: inDays(-1) }] }),
    hw({ hunt_lot_id: hl[1].id, producer: 'Divers', appellation: 'Bourgogne', region: 'Bourgogne', vintage: 2019, quantity: 8, drink_from: Y - 1, drink_until: Y + 3, market_low_eur: 30, market_high_eur: 40, market_confidence: 0.5 }),
    hw({ hunt_lot_id: hl[1].id, producer: 'Divers', appellation: 'Mercurey', region: 'Bourgogne', vintage: 2018, quantity: 4, drink_from: Y - 2, drink_until: Y + 2, market_low_eur: 45, market_high_eur: 60, market_confidence: 0.5 }),
    hw({ hunt_lot_id: hl[2].id, producer: 'Divers', appellation: 'Bordeaux supérieur', vintage: 2015, quantity: 24 }),
  ]
  // Prix adjugés passés (calibrage).
  for (let i = 0; i < 10; i++) {
    hl.push(lot({ sale_house: 'Ventes passées', title: `Lot passé ${i + 1}`, sale_date: inDays(-30 - i * 7), status: i % 3 ? 'ignore' : 'suivi',
      max_total_eur: 300 + i * 20, hammer_price_eur: 240 + i * 25, verdict: 'a_surveiller', score: 50 }))
  }

  return {
    settings: { ...DEFAULT_SETTINGS }, shelves, wines, prices, stockLots, purchases, movements: [], tastings,
    huntLots: hl, huntLotWines,
    jobs: [
      { id: uid(), type: 'label', ref_id: pending.id, payload: {}, status: 'en_attente', message: null, created_at: now(), started_at: null, done_at: null },
      { id: uid(), type: 'lot_url', ref_id: null, payload: { url: 'https://www.interencheres.com/vins-spiritueux/exemple' }, status: 'en_attente', message: null, created_at: now(), started_at: null, done_at: null },
    ],
    snapshots: Array.from({ length: 6 }, (_, i) => ({ id: uid(), date: new Date(Y, new Date().getMonth() - 5 + i, 1).toISOString().slice(0, 10),
      bottles: 40 + i, value_low_eur: 2200 + i * 90, value_high_eur: 2800 + i * 110, purchase_value_eur: 2000 + i * 60 })),
    loadedAt: now(),
  }
}

export const demoApi = (): Api => {
  let d: CellarData
  try {
    d = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? seed()
  } catch {
    d = seed()
  }
  const save = () => {
    d.loadedAt = now()
    try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* quota : la démo reste en mémoire */ }
  }
  save()
  const lot = (id: string) => {
    const l = d.stockLots.find((x) => x.id === id)
    if (!l) throw new Error('Bouteille introuvable')
    return l
  }
  const job = (type: CellarData['jobs'][number]['type'], ref: string | null, payload = {}) =>
    d.jobs.unshift({ id: uid(), type, ref_id: ref, payload, status: 'en_attente', message: null, created_at: now(), started_at: null, done_at: null })
  const newWine = (p: Partial<Wine>): Wine => ({
    id: uid(), producer: null, cuvee: null, appellation: null, region: null, country: null, vintage: null, color: null, grapes: [],
    bottle_size_cl: 75, classification: null, drink_from: null, drink_peak: null, drink_until: null, serving_temp_c: null, decant_min: null,
    pairings: [], confidence: {}, sources: [], notes: null, merge_candidate_id: null, status: 'en_attente', created_at: now(), updated_at: now(), ...p,
  })
  const addLot = (wineId: string, a: { quantity: number; shelfId: string | null; unitPrice: number | null; source: CellarData['purchases'][number]['source'] }, thumb: string | null = null) => {
    const l: StockLot = { id: uid(), wine_id: wineId, shelf_id: a.shelfId, quantity: a.quantity, label_photo_paths: thumb ? [thumb] : [], thumb_path: thumb,
      fill_level: null, label_condition: null, capsule_cork_condition: null, provenance: null, added_at: now() }
    d.stockLots.push(l)
    d.purchases.push({ id: uid(), wine_id: wineId, stock_lot_id: l.id, date: now().slice(0, 10), quantity: a.quantity, unit_price_eur: a.unitPrice, fees_eur: 0, source: a.source, hunt_lot_id: null })
    d.movements.unshift({ id: uid(), stock_lot_id: l.id, type: 'entree', quantity: a.quantity, date: now(), reason: a.source })
  }
  const run = async <T>(f: () => T | Promise<T>) => {
    const r = await f()
    save()
    return r
  }

  return {
    async loadAll() { return structuredClone(d) },
    addByPhoto: (a) => run(async () => {
      const w = newWine({})
      d.wines.push(w)
      addLot(w.id, a, await blobToDataUrl(a.thumb))
      job('label', w.id)
      return w.id
    }),
    addManual: (a) => run(() => {
      let id = a.wineId
      if (!id) {
        const w = newWine(a.wine)
        d.wines.push(w)
        id = w.id
        job('enrich', id)
      }
      addLot(id, a)
      return id
    }),
    updateWine: (id, p) => run(() => { Object.assign(d.wines.find((w) => w.id === id)!, p, { updated_at: now() }) }),
    updateStockLot: (id, p) => run(() => { Object.assign(lot(id), p) }),
    takeBottle: (id, qty, reason) => run(() => {
      const l = lot(id)
      if (l.quantity < qty) throw new Error(`Il ne reste que ${l.quantity} bouteille(s)`)
      l.quantity -= qty
      const m = { id: uid(), stock_lot_id: id, type: 'sortie' as const, quantity: qty, date: now(), reason }
      d.movements.unshift(m)
      return m.id
    }),
    moveBottles: (id, shelf, qty) => run(() => {
      const l = lot(id)
      if (qty >= l.quantity) l.shelf_id = shelf
      else {
        l.quantity -= qty
        d.stockLots.push({ ...l, id: uid(), shelf_id: shelf, quantity: qty })
      }
    }),
    addTasting: (t) => run(() => { d.tastings.unshift({ ...t, id: uid() }) }),
    updateTasting: (id, p) => run(() => { Object.assign(d.tastings.find((t) => t.id === id)!, p) }),
    mergeWine: (from, into) => run(() => {
      for (const l of d.stockLots) if (l.wine_id === from) l.wine_id = into
      for (const p of d.purchases) if (p.wine_id === from) p.wine_id = into
      d.wines = d.wines.filter((w) => w.id !== from)
    }),
    enqueue: (type, ref, payload) => run(() => {
      if (!d.jobs.some((j) => j.type === type && j.ref_id === ref && (j.status === 'en_attente' || j.status === 'en_cours'))) job(type, ref, payload)
    }),
    retryJob: (id) => run(() => { Object.assign(d.jobs.find((j) => j.id === id)!, { status: 'en_attente', message: null }) }),
    pasteLotUrl: (url) => run(() => { job('lot_url', null, { url }) }),
    updateHuntLot: (id, p) => run(() => { Object.assign(d.huntLots.find((h) => h.id === id)!, p) }),
    convertHuntLot: (id, hammer, shelf) => run(() => {
      const h = d.huntLots.find((x) => x.id === id)!
      if (h.status === 'achete') throw new Error('Lot déjà transformé en bouteilles')
      const ws = d.huntLotWines.filter((w) => w.hunt_lot_id === id)
      const n = ws.reduce((s, w) => s + w.quantity, 0)
      if (!n) throw new Error('Le lot ne contient aucun vin')
      for (const hw of ws) {
        const w = newWine({ producer: hw.producer, appellation: hw.appellation, region: hw.region, vintage: hw.vintage, color: hw.color, drink_from: hw.drink_from, drink_until: hw.drink_until })
        d.wines.push(w)
        if (hw.market_low_eur != null) d.prices.push({ id: uid(), wine_id: w.id, low_eur: hw.market_low_eur, high_eur: hw.market_high_eur, confidence: hw.market_confidence, sources: hw.market_sources, checked_at: now() })
        addLot(w.id, { quantity: hw.quantity, shelfId: shelf, unitPrice: Math.round((hammer / n) * 100) / 100, source: h.source === 'leboncoin' ? 'leboncoin' : 'vente' })
        const sl = d.stockLots[d.stockLots.length - 1]
        sl.fill_level = hw.fill_level
        sl.label_condition = hw.condition_notes
        sl.provenance = [h.provenance ?? h.sale_house, h.lot_number && `lot ${h.lot_number}`].filter(Boolean).join(' — ')
        job('enrich', w.id)
      }
      Object.assign(h, { status: 'achete', hammer_price_eur: hammer })
      return n
    }),
    rescore: async () => {},
    saveSettings: (p) => run(() => { Object.assign(d.settings, p) }),
    saveShelf: (s) => run(() => {
      const cur = s.id && d.shelves.find((x) => x.id === s.id)
      if (cur) Object.assign(cur, s)
      else d.shelves.push({ id: uid(), label: null, capacity: null, ...s })
      d.shelves.sort((a, b) => a.shelf_number - b.shelf_number)
    }),
    deleteShelf: (id) => run(() => {
      d.shelves = d.shelves.filter((s) => s.id !== id)
      for (const l of d.stockLots) if (l.shelf_id === id) l.shelf_id = null
    }),
    photoUrl: async (p) => p,
    housekeeping: async () => {},
  }
}

export const resetDemo = () => localStorage.removeItem(KEY)
