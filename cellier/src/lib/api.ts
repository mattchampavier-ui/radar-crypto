import { DEFAULT_SETTINGS } from './constants'
import { supabase } from './supabase'
import type {
  AiJob, CellarData, HuntLot, PurchaseSource, Settings, Shelf, StockLot, Tasting, Wine,
} from './types'

export interface PhotoAdd {
  photos: Blob[]       // compressées
  thumb: Blob          // miniature 3:4
  quantity: number
  shelfId: string | null
  unitPrice: number | null
  source: PurchaseSource
}

export interface ManualAdd {
  wineId: string | null          // vin déjà en cave, sinon création
  wine: Partial<Wine>
  quantity: number
  shelfId: string | null
  unitPrice: number | null
  source: PurchaseSource
}

export interface Api {
  loadAll(): Promise<CellarData>
  addByPhoto(a: PhotoAdd): Promise<string>
  addManual(a: ManualAdd): Promise<string>
  updateWine(id: string, patch: Partial<Wine>): Promise<void>
  updateStockLot(id: string, patch: Partial<StockLot>): Promise<void>
  takeBottle(stockLotId: string, qty: number, reason: string): Promise<string>
  moveBottles(stockLotId: string, shelfId: string, qty: number): Promise<void>
  addTasting(t: Omit<Tasting, 'id'>): Promise<void>
  updateTasting(id: string, patch: Partial<Tasting>): Promise<void>
  mergeWine(fromId: string, intoId: string): Promise<void>
  enqueue(type: AiJob['type'], refId: string | null, payload?: Record<string, unknown>): Promise<void>
  retryJob(id: string): Promise<void>
  pasteLotUrl(url: string): Promise<void>
  updateHuntLot(id: string, patch: Partial<HuntLot>): Promise<void>
  convertHuntLot(id: string, hammer: number, shelfId: string | null): Promise<number>
  rescore(): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  saveShelf(s: Partial<Shelf> & { shelf_number: number }): Promise<void>
  deleteShelf(id: string): Promise<void>
  photoUrl(path: string): Promise<string | null>
  /** Tâches de fond à l'ouverture : liens signés des photos en attente, revalorisation du mois. */
  housekeeping(): Promise<void>
}

const BUCKET = 'photos'

/** Implémentation Supabase. Toute la logique sensible (score, conversion, sorties) est en SQL. */
export const supabaseApi = (): Api => {
  const sb = supabase!
  const ok = <T>(r: { data: T | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message)
    return r.data as NonNullable<T>
  }
  const insertId = async (table: string, row: object) =>
    (ok(await sb.from(table).insert(row).select('id').single()) as { id: string }).id
  const uid = async () => {
    const { data } = await sb.auth.getUser()
    if (!data.user) throw new Error('Session expirée, reconnecte-toi')
    return data.user.id
  }

  const signPhotos = async (paths: string[], ttlHours: number) => {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, ttlHours * 3600)
    if (error) throw new Error(error.message)
    return {
      photo_urls: data.map((d) => d.signedUrl),
      expires_at: new Date(Date.now() + ttlHours * 3600e3).toISOString(),
    }
  }

  const settingsTtl = async () => {
    const { data } = await sb.from('settings').select('photo_link_ttl_hours').maybeSingle()
    return data?.photo_link_ttl_hours ?? DEFAULT_SETTINGS.photo_link_ttl_hours
  }

  const createPurchase = async (wineId: string, lotId: string, a: { quantity: number; unitPrice: number | null; source: PurchaseSource }) => {
    ok(await sb.from('purchases').insert({
      wine_id: wineId, stock_lot_id: lotId, quantity: a.quantity, unit_price_eur: a.unitPrice, source: a.source,
    }))
    ok(await sb.from('movements').insert({ stock_lot_id: lotId, type: 'entree', quantity: a.quantity, reason: a.source }))
  }

  return {
    async loadAll() {
      await sb.rpc('claim_app')
      const [settings, shelves, wines, prices, lots, purchases, movements, tastings, hunt, huntWines, jobs, snaps] = await Promise.all([
        sb.from('settings').select('*').maybeSingle(),
        sb.from('cabinet_shelves').select('*').order('shelf_number'),
        sb.from('wines').select('*'),
        sb.from('market_prices').select('*').order('checked_at'),
        sb.from('stock_lots').select('*'),
        sb.from('purchases').select('*').order('date'),
        sb.from('movements').select('*').order('date', { ascending: false }).limit(500),
        sb.from('tastings').select('*').order('date', { ascending: false }),
        sb.from('hunt_lots').select('*').order('created_at', { ascending: false }).limit(300),
        sb.from('hunt_lot_wines').select('*'),
        sb.from('ai_jobs').select('*').or(`status.in.(en_attente,en_cours,erreur),done_at.gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`).order('created_at', { ascending: false }).limit(200),
        sb.from('cellar_snapshots').select('*').order('date'),
      ])
      return {
        settings: { ...DEFAULT_SETTINGS, ...(ok(settings) ?? {}) },
        shelves: ok(shelves) ?? [],
        wines: ok(wines) ?? [],
        prices: ok(prices) ?? [],
        stockLots: ok(lots) ?? [],
        purchases: ok(purchases) ?? [],
        movements: ok(movements) ?? [],
        tastings: ok(tastings) ?? [],
        huntLots: ok(hunt) ?? [],
        huntLotWines: ok(huntWines) ?? [],
        jobs: ok(jobs) ?? [],
        snapshots: ok(snaps) ?? [],
        loadedAt: new Date().toISOString(),
      } as CellarData
    },

    async addByPhoto(a) {
      const owner = await uid()
      const wine = { id: await insertId('wines', { status: 'en_attente' }) }
      const lot = { id: await insertId('stock_lots', { wine_id: wine.id, shelf_id: a.shelfId, quantity: a.quantity }) }
      const base = `${owner}/${lot.id}`
      const paths: string[] = []
      for (const [i, p] of a.photos.entries()) {
        const path = `${base}/photo-${i + 1}.jpg`
        ok(await sb.storage.from(BUCKET).upload(path, p, { contentType: 'image/jpeg', upsert: true }))
        paths.push(path)
      }
      const thumbPath = `${base}/thumb.jpg`
      ok(await sb.storage.from(BUCKET).upload(thumbPath, a.thumb, { contentType: 'image/jpeg', upsert: true }))
      ok(await sb.from('stock_lots').update({ label_photo_paths: paths, thumb_path: thumbPath }).eq('id', lot.id))
      await createPurchase(wine.id, lot.id, a)
      const payload = { stock_lot_id: lot.id, photo_paths: paths, ...(await signPhotos(paths, await settingsTtl())) }
      ok(await sb.from('ai_jobs').insert({ type: 'label', ref_id: wine.id, payload }))
      return wine.id
    },

    async addManual(a) {
      let wineId = a.wineId
      if (!wineId) {
        wineId = await insertId('wines', { ...a.wine, status: 'en_attente' })
        ok(await sb.from('ai_jobs').insert({ type: 'enrich', ref_id: wineId }))
      }
      const lot = { id: await insertId('stock_lots', { wine_id: wineId, shelf_id: a.shelfId, quantity: a.quantity }) }
      await createPurchase(wineId!, lot.id, a)
      return wineId!
    },

    async updateWine(id, patch) { ok(await sb.from('wines').update(patch).eq('id', id)) },
    async updateStockLot(id, patch) { ok(await sb.from('stock_lots').update(patch).eq('id', id)) },
    async takeBottle(id, qty, reason) { return ok(await sb.rpc('take_bottle', { p_stock_lot: id, p_qty: qty, p_reason: reason })) as string },
    async moveBottles(id, shelf, qty) { ok(await sb.rpc('move_bottles', { p_stock_lot: id, p_shelf: shelf, p_qty: qty })) },
    async addTasting(t) { ok(await sb.from('tastings').insert(t)) },
    async updateTasting(id, patch) { ok(await sb.from('tastings').update(patch).eq('id', id)) },
    async mergeWine(from, into) { ok(await sb.rpc('merge_wine', { p_from: from, p_into: into })) },
    async enqueue(type, refId, payload = {}) {
      const existing = ok(await sb.from('ai_jobs').select('id').eq('type', type).in('status', ['en_attente', 'en_cours'])
        .filter('ref_id', refId ? 'eq' : 'is', refId ?? null))
      if (existing?.length) return
      ok(await sb.from('ai_jobs').insert({ type, ref_id: refId, payload }))
    },
    async retryJob(id) { ok(await sb.from('ai_jobs').update({ status: 'en_attente', message: null, done_at: null }).eq('id', id)) },
    async pasteLotUrl(url) { ok(await sb.from('ai_jobs').insert({ type: 'lot_url', payload: { url } })) },
    async updateHuntLot(id, patch) { ok(await sb.from('hunt_lots').update(patch).eq('id', id)) },
    async convertHuntLot(id, hammer, shelf) { return ok(await sb.rpc('convert_hunt_lot', { p_lot: id, p_hammer: hammer, p_shelf: shelf })) as number },
    async rescore() { ok(await sb.rpc('rescore_hunt_lots')) },
    async saveSettings(patch) {
      const owner = await uid()
      ok(await sb.from('settings').upsert({ owner, ...patch }))
    },
    async saveShelf(s) {
      if (s.id) ok(await sb.from('cabinet_shelves').update(s).eq('id', s.id))
      else ok(await sb.from('cabinet_shelves').insert(s))
    },
    async deleteShelf(id) { ok(await sb.from('cabinet_shelves').delete().eq('id', id)) },
    async photoUrl(path) {
      if (path.startsWith('http') || path.startsWith('data:')) return path
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
      return data?.signedUrl ?? null
    },
    async housekeeping() {
      await sb.rpc('ensure_monthly_revalue')
      // Les liens signés des photos doivent rester valides jusqu'au passage de la tâche.
      const { data: jobs } = await sb.from('ai_jobs').select('id,payload').eq('type', 'label').eq('status', 'en_attente')
      const ttl = await settingsTtl()
      for (const j of jobs ?? []) {
        const exp = j.payload?.expires_at ? new Date(j.payload.expires_at).getTime() : 0
        if (exp - Date.now() > 24 * 3600e3 || !j.payload?.photo_paths?.length) continue
        const signed = await signPhotos(j.payload.photo_paths, ttl)
        await sb.from('ai_jobs').update({ payload: { ...j.payload, ...signed } }).eq('id', j.id)
      }
    },
  }
}
