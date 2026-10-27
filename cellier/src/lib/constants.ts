import type { FillLevel, PurchaseSource, Settings, Verdict, WineColor } from './types'

export const COLORS: { id: WineColor; label: string }[] = [
  { id: 'rouge', label: 'Rouge' },
  { id: 'blanc', label: 'Blanc' },
  { id: 'rose', label: 'Rosé' },
  { id: 'effervescent', label: 'Effervescent' },
  { id: 'liquoreux', label: 'Liquoreux' },
]
export const colorLabel = (c: WineColor | null | undefined) => COLORS.find((x) => x.id === c)?.label ?? '—'

/** Liste fixe des types de plats, partagée avec la tâche Claude (champ wines.pairings). */
export const DISHES: { id: string; label: string }[] = [
  { id: 'viande_rouge', label: 'Viande rouge' },
  { id: 'viande_blanche', label: 'Viande blanche' },
  { id: 'volaille', label: 'Volaille' },
  { id: 'gibier', label: 'Gibier' },
  { id: 'poisson', label: 'Poisson' },
  { id: 'fruits_de_mer', label: 'Fruits de mer' },
  { id: 'charcuterie', label: 'Charcuterie' },
  { id: 'fromage', label: 'Fromage' },
  { id: 'plat_epice', label: 'Plat épicé' },
  { id: 'vegetarien', label: 'Végétarien' },
  { id: 'dessert', label: 'Dessert' },
  { id: 'aperitif', label: 'Apéritif' },
]
export const dishLabel = (id: string | null | undefined) => DISHES.find((d) => d.id === id)?.label ?? id ?? ''

export const OCCASIONS: { id: string; label: string }[] = [
  { id: 'quotidien', label: 'Soir de semaine' },
  { id: 'amis', label: 'Entre amis' },
  { id: 'fete', label: 'Grande occasion' },
]

export const FILL_LEVELS: { id: FillLevel; label: string }[] = [
  { id: 'goulot', label: 'Dans le col' },
  { id: 'haut_epaule', label: 'Haut d’épaule' },
  { id: 'mi_epaule', label: 'Mi-épaule' },
  { id: 'bas_epaule', label: 'Bas d’épaule' },
]
export const fillLabel = (f: FillLevel | null | undefined) => FILL_LEVELS.find((x) => x.id === f)?.label ?? 'Non renseigné'

export const SOURCES: { id: PurchaseSource; label: string }[] = [
  { id: 'vente', label: 'Vente aux enchères' },
  { id: 'caviste', label: 'Caviste' },
  { id: 'cadeau', label: 'Cadeau' },
  { id: 'leboncoin', label: 'Leboncoin' },
  { id: 'autre', label: 'Autre' },
]
export const sourceLabel = (s: string | null | undefined) => SOURCES.find((x) => x.id === s)?.label ?? s ?? ''

export const VERDICTS: Record<Verdict, string> = {
  a_viser: 'À viser',
  a_surveiller: 'À surveiller',
  a_ignorer: 'À ignorer',
}

/** En dessous de ce seuil, un champ rempli par la tâche Claude est signalé en orange. */
export const UNCERTAIN_BELOW = 0.6

export const DEFAULT_SETTINGS: Settings = {
  budget_min: 300,
  budget_max: 1000,
  zone: ['Lyon', '69', 'Rhône', 'Auvergne-Rhône-Alpes', 'Bourgogne', '21', '71', 'Jura', '39', 'Savoie', '73', '74', '01', '38', '42', '26', '07'],
  horizon_days: 31,
  default_fees_rate: 0.25,
  monthly_consumption: 6,
  color_targets: {},
  weights: { discount: 40, gap: 30, affinity: 20, info: 10, discount_full_at: 0.35 },
  thresholds: { target: 70, watch: 45 },
  affinity_min_score: 16,
  ai_run_hours: [12, 20],
  ai_batch_size: 20,
  photo_link_ttl_hours: 72,
  theme: 'system',
}
