import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Empty, Field, PageHeader, Segmented, Sheet } from '../components/ui'
import { DISHES, dishLabel, OCCASIONS } from '../lib/constants'
import { wineTitle } from '../lib/cellar'
import { date } from '../lib/format'
import { useStore } from '../lib/store'
import type { Tasting } from '../lib/types'

export default function Journal() {
  const { data, act } = useStore()
  const nav = useNavigate()
  const d = data!
  const [edit, setEdit] = useState<Tasting | null>(null)
  const wines = new Map(d.wines.map((w) => [w.id, w]))
  const scores = d.tastings.map((t) => t.score_20).filter((s): s is number => s != null)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  return (
    <>
      <PageHeader title="Journal" back subtitle={`${d.tastings.length} dégustation${d.tastings.length > 1 ? 's' : ''}${avg != null ? ` · moyenne ${avg.toFixed(1).replace('.', ',')}/20` : ''}`} />
      <div className="px-safe space-y-2">
        {d.tastings.map((t) => {
          const w = t.wine_id ? wines.get(t.wine_id) : undefined
          return (
            <Card key={t.id} className="p-3" onClick={() => setEdit(t)}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-display text-[17px] font-semibold">{w ? `${wineTitle(w)} ${w.vintage ?? ''}` : 'Vin supprimé'}</span>
                {t.score_20 != null && <span className={`tnum shrink-0 font-display text-[20px] ${t.score_20 >= d.settings.affinity_min_score ? 'text-ok' : ''}`}>{String(t.score_20).replace('.', ',')}<span className="text-[13px] text-muted">/20</span></span>}
              </div>
              <div className="text-[13px] text-muted">{[date(t.date), t.dish_type && dishLabel(t.dish_type), OCCASIONS.find((o) => o.id === t.occasion)?.label].filter(Boolean).join(' · ')}</div>
              {t.notes && <p className="mt-1 text-[15px]">{t.notes}</p>}
              {w && <button className="mt-1 min-h-9 text-[14px] text-primary" onClick={(e) => { e.stopPropagation(); nav(`/vin/${w.id}`) }}>Voir la fiche</button>}
            </Card>
          )
        })}
        {!d.tastings.length && <Empty>Sors une bouteille de la cave pour noter ta première dégustation.</Empty>}
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Dégustation">
        {edit && (
          <>
            <Field label="Note sur 20"><input className="field tnum" inputMode="decimal" value={edit.score_20 ?? ''} onChange={(e) => setEdit({ ...edit, score_20: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} /></Field>
            <Field label="Commentaire"><textarea className="field min-h-24" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value || null })} /></Field>
            <Field label="Plat">
              <select className="field" value={edit.dish_type ?? ''} onChange={(e) => setEdit({ ...edit, dish_type: e.target.value || null })}>
                <option value="">—</option>{DISHES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="Occasion"><Segmented value={edit.occasion ?? ''} onChange={(o) => setEdit({ ...edit, occasion: o })} wrap options={OCCASIONS} /></Field>
            <Button className="w-full" onClick={async () => {
              await act((a) => a.updateTasting(edit.id, { score_20: edit.score_20, notes: edit.notes, dish_type: edit.dish_type, occasion: edit.occasion }), 'Enregistré')
              setEdit(null)
            }}>Enregistrer</Button>
          </>
        )}
      </Sheet>
    </>
  )
}
