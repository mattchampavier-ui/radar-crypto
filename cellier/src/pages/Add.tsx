import { Camera, ImagePlus, Keyboard, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, ICON, PageHeader, Segmented, Stepper } from '../components/ui'
import { COLORS, SOURCES } from '../lib/constants'
import { compressImage, makeThumb } from '../lib/image'
import { takePendingPhotos } from '../lib/pendingPhotos'
import { useStore } from '../lib/store'
import type { PurchaseSource, WineColor } from '../lib/types'

interface Shot { full: Blob; preview: string }

const QUICK_SOURCES = SOURCES.filter((s) => ['vente', 'caviste', 'cadeau'].includes(s.id))

export default function Add() {
  const { data, act, online } = useStore()
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'photo' | 'manuel'>('photo')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [shelfId, setShelfId] = useState<string>(() => localStorage.getItem('cellier.lastShelf') ?? '')
  const [price, setPrice] = useState('')
  const [source, setSource] = useState<PurchaseSource>(() => (localStorage.getItem('cellier.lastSource') as PurchaseSource) ?? 'caviste')
  const shelves = data!.shelves

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const out: Shot[] = []
      for (const f of files) {
        const full = await compressImage(f)
        out.push({ full, preview: URL.createObjectURL(full) })
      }
      setShots((s) => [...s, ...out])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const p = takePendingPhotos()
    if (p.length) addFiles(p)
  }, [])

  const reset = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.preview))
    setShots([])
    setQuantity(1)
    setPrice('')
  }

  const remember = () => {
    localStorage.setItem('cellier.lastShelf', shelfId)
    localStorage.setItem('cellier.lastSource', source)
  }
  const unitPrice = price ? Number(price.replace(',', '.')) : null

  const save = async () => {
    setBusy(true)
    const thumb = await makeThumb(shots[0].full)
    const id = await act(
      (api) => api.addByPhoto({ photos: shots.map((s) => s.full), thumb, quantity, shelfId: shelfId || null, unitPrice, source }),
      'Ajoutée — fiche remplie au prochain passage',
    )
    setBusy(false)
    if (id) {
      remember()
      reset()
    }
  }

  const commonFields = (
    <>
      <Field label="Quantité"><Stepper value={quantity} onChange={setQuantity} /></Field>
      <Field label="Clayette">
        <Segmented value={shelfId} onChange={setShelfId} options={[{ id: '', label: '—' }, ...shelves.map((s) => ({ id: s.id, label: String(s.shelf_number) }))]} />
      </Field>
      <Field label="Prix payé par bouteille (€)">
        <input className="field tnum" inputMode="decimal" placeholder="Facultatif" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label="Source">
        <Segmented value={source} onChange={setSource} options={QUICK_SOURCES} />
      </Field>
    </>
  )

  return (
    <>
      <PageHeader title="Ajouter" right={
        <Button variant="ghost" className="!px-2" onClick={() => setMode(mode === 'photo' ? 'manuel' : 'photo')}>
          {mode === 'photo' ? <><Keyboard {...ICON} /> Saisie</> : <><Camera {...ICON} /> Photo</>}
        </Button>
      } />
      <div className="px-safe">
        {!online && <p className="mb-3 rounded-card bg-warn/15 p-3 text-[15px] text-warn">Hors ligne : l’ajout demande du réseau.</p>}
        {mode === 'photo' ? (
          <>
            <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; addFiles(f) }} />
            {shots.length === 0 ? (
              <button onClick={() => input.current?.click()} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line bg-surface text-primary">
                <Camera size={40} strokeWidth={1.5} />
                <span className="text-[17px] font-medium">{busy ? 'Préparation…' : 'Photographier l’étiquette'}</span>
                <span className="text-[14px] text-muted">Puis la contre-étiquette si besoin</span>
              </button>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {shots.map((s, i) => (
                    <div key={s.preview} className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-thumb bg-surface-2">
                      <img src={s.preview} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                      <button aria-label="Retirer" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white"
                        onClick={() => setShots(shots.filter((x) => x !== s))}><X size={16} /></button>
                    </div>
                  ))}
                  <button onClick={() => input.current?.click()} className="flex aspect-[3/4] w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-thumb border-2 border-dashed border-line text-[13px] text-primary">
                    <ImagePlus {...ICON} /> Contre-étiquette
                  </button>
                </div>
                <div className="mt-4">{commonFields}</div>
                <Button className="mt-1 w-full" disabled={busy || !online} onClick={save}>
                  Ajouter {quantity} bouteille{quantity > 1 ? 's' : ''}
                </Button>
              </>
            )}
            <p className="mt-4 text-[14px] text-muted">
              La bouteille apparaît tout de suite en cave avec le badge « En attente ». La tâche Claude lit l’étiquette au prochain passage
              ({data!.settings.ai_run_hours.map((h) => `${h} h`).join(' et ')}).
            </p>
          </>
        ) : (
          <ManualForm onDone={() => nav('/cave')} commonFields={commonFields} values={{ quantity, shelfId, unitPrice, source }} onSaved={remember} />
        )}
      </div>
    </>
  )
}

function ManualForm({ commonFields, values, onDone, onSaved }: {
  commonFields: React.ReactNode
  values: { quantity: number; shelfId: string; unitPrice: number | null; source: PurchaseSource }
  onDone: () => void
  onSaved: () => void
}) {
  const { data, act, online } = useStore()
  const [producer, setProducer] = useState('')
  const [cuvee, setCuvee] = useState('')
  const [appellation, setAppellation] = useState('')
  const [vintage, setVintage] = useState('')
  const [color, setColor] = useState<WineColor>('rouge')
  const wines = data!.wines.filter((w) => w.producer)
  const producers = useMemo(() => [...new Set(wines.map((w) => w.producer!))].sort(), [wines])
  const appellations = useMemo(() => [...new Set(data!.wines.map((w) => w.appellation).filter(Boolean) as string[])].sort(), [data])

  // Vin déjà en cave : même domaine, cuvée, appellation et millésime.
  const existing = wines.find((w) =>
    w.producer!.toLowerCase() === producer.trim().toLowerCase() &&
    (w.cuvee ?? '').toLowerCase() === cuvee.trim().toLowerCase() &&
    (w.appellation ?? '').toLowerCase() === appellation.trim().toLowerCase() &&
    String(w.vintage ?? '') === vintage.trim())

  const save = async () => {
    const id = await act((api) => api.addManual({
      wineId: existing?.id ?? null,
      wine: { producer: producer.trim() || null, cuvee: cuvee.trim() || null, appellation: appellation.trim() || null, vintage: vintage ? Number(vintage) : null, color },
      quantity: values.quantity, shelfId: values.shelfId || null, unitPrice: values.unitPrice, source: values.source,
    }), existing ? 'Ajoutée au vin existant' : 'Ajoutée — fiche enrichie au prochain passage')
    if (id) { onSaved(); onDone() }
  }

  return (
    <>
      <datalist id="producers">{producers.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="appellations">{appellations.map((p) => <option key={p} value={p} />)}</datalist>
      <Field label="Domaine"><input className="field" list="producers" value={producer} onChange={(e) => setProducer(e.target.value)} autoComplete="off" /></Field>
      <Field label="Cuvée"><input className="field" value={cuvee} onChange={(e) => setCuvee(e.target.value)} /></Field>
      <div className="flex gap-2">
        <div className="flex-[2]"><Field label="Appellation"><input className="field" list="appellations" value={appellation} onChange={(e) => setAppellation(e.target.value)} autoComplete="off" /></Field></div>
        <div className="flex-1"><Field label="Millésime"><input className="field tnum" inputMode="numeric" maxLength={4} value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, ''))} /></Field></div>
      </div>
      <Field label="Couleur"><Segmented value={color} onChange={setColor} options={COLORS} /></Field>
      {existing && <p className="mb-3 rounded-card bg-primary-soft p-3 text-[15px] text-primary">Ce vin est déjà en cave : les bouteilles s’ajouteront à sa fiche.</p>}
      {commonFields}
      <Button className="mt-1 w-full" disabled={!online || !(producer || appellation)} onClick={save}>Ajouter</Button>
    </>
  )
}
