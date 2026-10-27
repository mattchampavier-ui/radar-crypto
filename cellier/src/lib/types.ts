export type WineColor = 'rouge' | 'blanc' | 'rose' | 'effervescent' | 'liquoreux'
export type WineStatus = 'en_attente' | 'enrichi' | 'a_verifier'
export type FillLevel = 'goulot' | 'haut_epaule' | 'mi_epaule' | 'bas_epaule'
export type PurchaseSource = 'vente' | 'caviste' | 'cadeau' | 'leboncoin' | 'autre'
export type JobType = 'label' | 'enrich' | 'lot_url' | 'revalue' | 'feasibility'
export type JobStatus = 'en_attente' | 'en_cours' | 'fait' | 'erreur'
export type Verdict = 'a_viser' | 'a_surveiller' | 'a_ignorer'
export type HuntStatus = 'nouveau' | 'suivi' | 'achete' | 'ignore'

export interface Source {
  url: string
  checked_at?: string
  label?: string
  about?: string
}

export interface Settings {
  owner?: string
  budget_min: number
  budget_max: number
  zone: string[]
  horizon_days: number
  default_fees_rate: number
  monthly_consumption: number
  color_targets: Partial<Record<WineColor, number>>
  weights: { discount: number; gap: number; affinity: number; info: number; discount_full_at?: number }
  thresholds: { target: number; watch: number }
  affinity_min_score: number
  ai_run_hours: number[]
  ai_batch_size: number
  photo_link_ttl_hours: number
  theme: 'system' | 'light' | 'dark'
}

export interface Wine {
  id: string
  producer: string | null
  cuvee: string | null
  appellation: string | null
  region: string | null
  country: string | null
  vintage: number | null
  color: WineColor | null
  grapes: string[]
  bottle_size_cl: number
  classification: string | null
  drink_from: number | null
  drink_peak: number | null
  drink_until: number | null
  serving_temp_c: number | null
  decant_min: number | null
  pairings: string[]
  confidence: Record<string, number>
  sources: Source[]
  notes: string | null
  merge_candidate_id: string | null
  status: WineStatus
  created_at: string
  updated_at: string
}

export interface MarketPrice {
  id: string
  wine_id: string
  low_eur: number | null
  high_eur: number | null
  confidence: number | null
  sources: Source[]
  checked_at: string
}

export interface Shelf {
  id: string
  shelf_number: number
  label: string | null
  capacity: number | null
}

export interface StockLot {
  id: string
  wine_id: string
  shelf_id: string | null
  quantity: number
  label_photo_paths: string[]
  thumb_path: string | null
  fill_level: FillLevel | null
  label_condition: string | null
  capsule_cork_condition: string | null
  provenance: string | null
  added_at: string
}

export interface Purchase {
  id: string
  wine_id: string
  stock_lot_id: string | null
  date: string
  quantity: number
  unit_price_eur: number | null
  fees_eur: number
  source: PurchaseSource | null
  hunt_lot_id: string | null
}

export interface Movement {
  id: string
  stock_lot_id: string
  type: 'entree' | 'sortie' | 'deplacement'
  quantity: number
  date: string
  reason: string | null
}

export interface Tasting {
  id: string
  wine_id: string | null
  movement_id: string | null
  date: string
  score_20: number | null
  notes: string | null
  occasion: string | null
  dish_type: string | null
}

export interface HuntLot {
  id: string
  source: 'lien' | 'interencheres' | 'leboncoin'
  url: string | null
  sale_house: string | null
  sale_date: string | null
  pickup_date: string | null
  location: string | null
  lot_number: string | null
  title: string | null
  description: string | null
  photos: string[]
  provenance: string | null
  estimate_low_eur: number | null
  estimate_high_eur: number | null
  fees_rate: number | null
  max_bid_eur: number | null
  max_total_eur: number | null
  score: number | null
  score_detail: {
    discount?: number
    gap?: number
    affinity?: number
    info?: number
    eliminated?: string[]
    fees_rate?: number
    cost?: number
    market_low?: number
    market_high?: number
    confidence?: number
    bottles?: number
  }
  verdict: Verdict | null
  reason: string | null
  gap_filled: string | null
  hammer_price_eur: number | null
  status: HuntStatus
  created_at: string
}

export interface HuntLotWine {
  id: string
  hunt_lot_id: string
  producer: string | null
  cuvee: string | null
  appellation: string | null
  region: string | null
  vintage: number | null
  color: WineColor | null
  bottle_size_cl: number
  quantity: number
  fill_level: FillLevel | null
  condition_notes: string | null
  cork_rising: boolean
  drink_from: number | null
  drink_until: number | null
  market_low_eur: number | null
  market_high_eur: number | null
  market_confidence: number | null
  market_sources: Source[]
  wine_id: string | null
}

export interface AiJob {
  id: string
  type: JobType
  ref_id: string | null
  payload: Record<string, unknown>
  status: JobStatus
  message: string | null
  created_at: string
  started_at: string | null
  done_at: string | null
}

export interface Snapshot {
  id: string
  date: string
  bottles: number
  value_low_eur: number | null
  value_high_eur: number | null
  purchase_value_eur: number | null
}

export interface CellarData {
  settings: Settings
  shelves: Shelf[]
  wines: Wine[]
  prices: MarketPrice[]
  stockLots: StockLot[]
  purchases: Purchase[]
  movements: Movement[]
  tastings: Tasting[]
  huntLots: HuntLot[]
  huntLotWines: HuntLotWine[]
  jobs: AiJob[]
  snapshots: Snapshot[]
  loadedAt: string
}
