import { colorLabel, fillLabel } from './constants'
import { buildRows } from './cellar'
import type { CellarData } from './types'

const csvCell = (v: unknown) => {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join(' | ') : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV lisible dans Excel / Numbers (séparateur point-virgule, BOM UTF-8). */
export function cellarCsv(d: CellarData) {
  const shelves = new Map(d.shelves.map((s) => [s.id, s]))
  const rows = buildRows(d)
  const head = ['Domaine', 'Cuvée', 'Appellation', 'Région', 'Pays', 'Millésime', 'Couleur', 'Format (cl)', 'Cépages', 'Clayette',
    'Quantité', 'Niveau', 'Étiquette', 'Bouchon', 'Provenance', 'Boire de', 'Apogée', 'Boire jusqu’à', 'Prix marché bas', 'Prix marché haut',
    'Prix payé unitaire', 'Statut fiche']
  const lines = [head]
  for (const r of rows)
    for (const l of r.lots)
      lines.push([
        r.wine.producer, r.wine.cuvee, r.wine.appellation, r.wine.region, r.wine.country, r.wine.vintage, colorLabel(r.wine.color),
        r.wine.bottle_size_cl, r.wine.grapes, l.shelf_id ? shelves.get(l.shelf_id)?.shelf_number : '', l.quantity, fillLabel(l.fill_level),
        l.label_condition, l.capsule_cork_condition, l.provenance, r.wine.drink_from, r.wine.drink_peak, r.wine.drink_until,
        r.price?.low_eur, r.price?.high_eur, r.unitCost?.toFixed(2), r.wine.status,
      ].map(csvCell) as string[])
  return '﻿' + lines.map((l) => l.join(';')).join('\n')
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const exportName = (ext: string) => `cellier-${new Date().toISOString().slice(0, 10)}.${ext}`
