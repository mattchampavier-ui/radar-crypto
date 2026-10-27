import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TakeBottleSheet } from '../components/TakeBottleSheet'
import { Button, Card, Empty, Field, PageHeader, Pill, Segmented, Thumb, VintageBadge, WineDot } from '../components/ui'
import { DISHES, OCCASIONS } from '../lib/constants'
import { wineSubtitle, wineTitle, type CellarRow } from '../lib/cellar'
import { eur } from '../lib/format'
import { useStore } from '../lib/store'
import { bottlePrice, suggestTonight } from '../lib/tonight'

/** « Quoi ouvrir ce soir » : calculé dans l'app, instantané et disponible hors ligne. */
export default function Tonight() {
  const { rows } = useStore()
  const nav = useNavigate()
  const [dish, setDish] = useState(() => localStorage.getItem('cellier.tonight.dish') ?? 'viande_rouge')
  const [occasion, setOccasion] = useState('quotidien')
  const [max, setMax] = useState('')
  const [taking, setTaking] = useState<CellarRow | null>(null)

  const picks = useMemo(
    () => suggestTonight(rows, { dish, occasion, maxPrice: max ? Number(max) : null }),
    [rows, dish, occasion, max],
  )

  return (
    <>
      <PageHeader title="Ce soir" back />
      <div className="px-safe">
        <Field label="Au menu">
          <div className="flex flex-wrap gap-1.5">
            {DISHES.map((d) => (
              <button key={d.id} onClick={() => { setDish(d.id); localStorage.setItem('cellier.tonight.dish', d.id) }}
                className={`anim min-h-11 rounded-full px-3.5 text-[15px] ${dish === d.id ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>{d.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Occasion"><Segmented value={occasion} onChange={setOccasion} wrap options={OCCASIONS} /></Field>
        <Field label="Plafond de prix (€, facultatif)">
          <input className="field tnum" inputMode="numeric" placeholder="Pas de plafond" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
        </Field>

        <h2 className="mb-2 mt-5 text-[19px]">Mes trois propositions</h2>
        {picks.length ? (
          <div className="space-y-2">
            {picks.map((s, i) => {
              const w = s.row.wine
              const p = bottlePrice(s.row)
              return (
                <Card key={w.id} className="p-3">
                  <div className="flex gap-3" onClick={() => nav(`/vin/${w.id}`)}>
                    <Thumb path={s.row.thumb} color={w.color} className="w-14" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display text-[15px] text-accent">{i + 1}</span>
                        <WineDot color={w.color} />
                        <span className="truncate font-display text-[17px] font-semibold">{wineTitle(w)}</span>
                      </div>
                      <div className="truncate text-[14px] text-muted">{wineSubtitle(w)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <VintageBadge vintage={w.vintage} />
                        <Pill tone="primary">Clayette {s.row.shelves.map((x) => x.shelf_number).join(', ') || '?'}</Pill>
                        {p != null && <span className="tnum text-[13px] text-muted">~{eur(p)}</span>}
                      </div>
                      <p className="mt-1.5 text-[14px]">{s.reasons.join(' · ')}{!s.matched && <span className="text-muted"> · accord non renseigné pour ce plat</span>}</p>
                      {(w.serving_temp_c != null || w.decant_min) && (
                        <p className="text-[13px] text-muted">{[w.serving_temp_c != null && `Servir à ${w.serving_temp_c} °C`, w.decant_min && `carafer ${w.decant_min} min`].filter(Boolean).join(', ')}</p>
                      )}
                    </div>
                  </div>
                  <Button variant="secondary" className="mt-2 w-full" onClick={() => setTaking(s.row)}>Je l’ouvre</Button>
                </Card>
              )
            })}
          </div>
        ) : (
          <Empty>Aucune bouteille dans sa fenêtre ne convient. Essaie sans plafond de prix.</Empty>
        )}
        <div className="h-6" />
      </div>
      <TakeBottleSheet row={taking} presetDish={dish} presetOccasion={occasion} onClose={() => setTaking(null)} />
    </>
  )
}
