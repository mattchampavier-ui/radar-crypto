import { useEffect, useState } from 'react'
import { DISHES, OCCASIONS } from '../lib/constants'
import { wineTitle, type CellarRow } from '../lib/cellar'
import { useStore } from '../lib/store'
import { Button, Field, Segmented, Sheet, Stepper } from './ui'

/** Sortie d'une bouteille, puis journal de dégustation (section 4.2). */
export function TakeBottleSheet({ row, onClose, presetDish, presetOccasion }: { row: CellarRow | null; onClose: () => void; presetDish?: string; presetOccasion?: string }) {
  const { act } = useStore()
  const [step, setStep] = useState<'take' | 'taste'>('take')
  const [lotId, setLotId] = useState('')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('dégustation')
  const [movementId, setMovementId] = useState<string | null>(null)
  const [score, setScore] = useState('')
  const [notes, setNotes] = useState('')
  const [dish, setDish] = useState(presetDish ?? '')
  const [occasion, setOccasion] = useState(presetOccasion ?? 'quotidien')

  useEffect(() => {
    if (!row) return
    setStep('take')
    setLotId(row.lots[0]?.id ?? '')
    setQty(1)
    setReason('dégustation')
    setScore('')
    setNotes('')
    setDish(presetDish ?? '')
    setOccasion(presetOccasion ?? 'quotidien')
  }, [row, presetDish, presetOccasion])

  if (!row) return null
  const lot = row.lots.find((l) => l.id === lotId) ?? row.lots[0]
  const shelfOf = (id: string | null) => row.shelves.find((s) => s.id === id)?.shelf_number

  const take = async () => {
    const m = await act((api) => api.takeBottle(lot.id, qty, reason), `${qty} bouteille${qty > 1 ? 's' : ''} sortie${qty > 1 ? 's' : ''}`)
    if (m === undefined) return
    if (reason === 'dégustation') {
      setMovementId(m)
      setStep('taste')
    } else onClose()
  }

  const saveTasting = async () => {
    await act((api) => api.addTasting({
      wine_id: row.wine.id, movement_id: movementId, date: new Date().toISOString().slice(0, 10),
      score_20: score === '' ? null : Math.min(20, Math.max(0, Number(score.replace(',', '.')))),
      notes: notes || null, occasion, dish_type: dish || null,
    }), 'Dégustation notée')
    onClose()
  }

  return (
    <Sheet open={!!row} onClose={onClose} title={step === 'take' ? 'Sortir une bouteille' : 'Journal de dégustation'}>
      <p className="mb-4 text-[15px] text-muted">{wineTitle(row.wine)} {row.wine.vintage ?? ''}</p>
      {step === 'take' ? (
        <>
          {row.lots.length > 1 && (
            <Field label="Depuis">
              <select className="field" value={lot.id} onChange={(e) => setLotId(e.target.value)}>
                {row.lots.map((l) => (
                  <option key={l.id} value={l.id}>Clayette {shelfOf(l.shelf_id) ?? '?'} — {l.quantity} btl</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Quantité">
            <Stepper value={qty} onChange={setQty} max={lot.quantity} />
          </Field>
          <Field label="Motif">
            <Segmented value={reason} onChange={setReason} wrap options={[
              { id: 'dégustation', label: 'Dégustation' },
              { id: 'offerte', label: 'Offerte' },
              { id: 'cassée', label: 'Cassée / bouchonnée' },
            ]} />
          </Field>
          <Button className="mt-2 w-full" onClick={take}>Sortir {qty} bouteille{qty > 1 ? 's' : ''}</Button>
        </>
      ) : (
        <>
          <Field label="Note sur 20">
            <input className="field tnum" inputMode="decimal" placeholder="16,5" value={score} onChange={(e) => setScore(e.target.value)} />
          </Field>
          <Field label="Commentaire">
            <textarea className="field min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nez, bouche, avec quoi…" />
          </Field>
          <Field label="Plat">
            <select className="field" value={dish} onChange={(e) => setDish(e.target.value)}>
              <option value="">—</option>
              {DISHES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Occasion">
            <Segmented value={occasion} onChange={setOccasion} wrap options={OCCASIONS} />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Plus tard</Button>
            <Button className="flex-1" onClick={saveTasting}>Enregistrer</Button>
          </div>
        </>
      )}
    </Sheet>
  )
}
