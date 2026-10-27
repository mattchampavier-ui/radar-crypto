import { ArrowRightLeft, ExternalLink, GitMerge, LogOut, Pencil, RefreshCw, Thermometer, Timer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { GardeFrise } from '../components/GardeFrise'
import { TakeBottleSheet } from '../components/TakeBottleSheet'
import { Button, Card, Empty, Field, GardeBadge, ICON, PageHeader, Pill, Section, Segmented, Sheet, Stepper, Thumb, usePhotoUrl, VintageBadge, WineDot } from '../components/ui'
import { COLORS, colorLabel, DISHES, dishLabel, FILL_LEVELS, fillLabel, sourceLabel } from '../lib/constants'
import { buildRows, isUncertain, latestPrices, wineTitle } from '../lib/cellar'
import { date, eur, eurRange, pct } from '../lib/format'
import { useStore } from '../lib/store'
import type { FillLevel, StockLot, Wine } from '../lib/types'

export default function WineDetail() {
  const { id } = useParams()
  const { data, act } = useStore()
  const nav = useNavigate()
  const d = data!
  const wine = d.wines.find((w) => w.id === id)
  const row = useMemo(() => buildRows(d, true).find((r) => r.wine.id === id), [d, id])
  const [taking, setTaking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [lotEdit, setLotEdit] = useState<StockLot | null>(null)
  const [moving, setMoving] = useState<StockLot | null>(null)

  if (!wine) return (<><PageHeader title="Vin" back /><div className="px-safe"><Empty>Ce vin n’existe plus.</Empty></div></>)

  const price = latestPrices(d.prices).get(wine.id)
  const lots = (row?.lots ?? []).filter((l) => l.quantity > 0)
  const qty = lots.reduce((s, l) => s + l.quantity, 0)
  const lotIds = new Set(d.stockLots.filter((l) => l.wine_id === wine.id).map((l) => l.id))
  const purchases = d.purchases.filter((p) => p.wine_id === wine.id)
  const exits = d.movements.filter((m) => lotIds.has(m.stock_lot_id) && m.type === 'sortie')
  const tastings = d.tastings.filter((t) => t.wine_id === wine.id)
  const merge = wine.merge_candidate_id ? d.wines.find((w) => w.id === wine.merge_candidate_id) : null
  const shelfNo = (sid: string | null) => d.shelves.find((s) => s.id === sid)?.shelf_number
  const job = d.jobs.find((j) => j.ref_id === wine.id && (j.status === 'en_attente' || j.status === 'en_cours'))
  const photos = lots.flatMap((l) => l.label_photo_paths)
  const u = (f: string) => isUncertain(wine, f)

  return (
    <>
      <PageHeader title={wineTitle(wine)} back right={
        <button aria-label="Modifier" className="flex h-11 w-11 items-center justify-center text-primary" onClick={() => setEditing(true)}><Pencil {...ICON} /></button>
      } />
      <div className="px-safe">
        <div className="flex gap-3">
          <PhotoStrip paths={photos} color={wine.color} />
          <div className="min-w-0 flex-1">
            <div className={`text-[15px] ${u('cuvee') ? 'text-warn' : ''}`}>{wine.cuvee}</div>
            <div className={`text-[15px] text-muted ${u('appellation') ? '!text-warn' : ''}`}>{[wine.appellation, wine.classification].filter(Boolean).join(' · ')}</div>
            <div className="text-[15px] text-muted">{[wine.region, wine.country].filter(Boolean).join(', ')}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={u('vintage') ? 'rounded-full ring-2 ring-warn' : ''}><VintageBadge vintage={wine.vintage} /></span>
              <span className="flex items-center gap-1 text-[14px]"><WineDot color={wine.color} />{colorLabel(wine.color)}</span>
              {wine.bottle_size_cl !== 75 && <Pill>{wine.bottle_size_cl} cl</Pill>}
            </div>
            {wine.grapes.length > 0 && <div className={`mt-1 text-[14px] ${u('grapes') ? 'text-warn' : 'text-muted'}`}>{wine.grapes.join(', ')}</div>}
            <div className="mt-2 flex items-baseline gap-1"><span className="tnum font-display text-[28px]">{qty}</span><span className="text-muted">en cave</span></div>
          </div>
        </div>

        {wine.status === 'en_attente' && (
          <Card className="mt-4 p-3 text-[15px]">
            <Pill tone="accent">En attente</Pill> La fiche sera remplie au prochain passage de la tâche Claude{job?.status === 'en_cours' ? ' (en cours)' : ''}.
          </Card>
        )}
        {merge && (
          <Card className="mt-4 p-3">
            <div className="flex items-start gap-2 text-[15px]"><GitMerge {...ICON} className="mt-0.5 shrink-0 text-warn" />
              <span>Ce vin semble déjà en cave : <b>{wineTitle(merge)} {merge.vintage}</b>. Fusionner les deux fiches ?</span></div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => act((a) => a.updateWine(wine.id, { merge_candidate_id: null }), 'Fiches gardées séparées')}>Garder séparé</Button>
              <Button className="flex-1" onClick={async () => { await act((a) => a.mergeWine(wine.id, merge.id), 'Fiches fusionnées'); nav(`/vin/${merge.id}`, { replace: true }) }}>Fusionner</Button>
            </div>
          </Card>
        )}
        {wine.status === 'a_verifier' && (
          <Card className="mt-4 border border-warn p-3">
            <p className="text-[15px]">Les champs en orange sont incertains. Vérifie-les sur l’étiquette.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(true)}>Corriger</Button>
              <Button className="flex-1" onClick={() => act((a) => a.updateWine(wine.id, { status: 'enrichi' }), 'Fiche validée')}>Tout est bon</Button>
            </div>
          </Card>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button variant="secondary" className="!px-2 text-[14px]" disabled={!qty} onClick={() => setTaking(true)}><LogOut size={18} strokeWidth={1.75} />Sortir</Button>
          <Button variant="secondary" className="!px-2 text-[14px]" disabled={!lots.length} onClick={() => setMoving(lots[0])}><ArrowRightLeft size={18} strokeWidth={1.75} />Déplacer</Button>
          <Button variant="secondary" className="!px-2 text-[14px]" disabled={!!job} onClick={() => act((a) => a.enqueue('enrich', wine.id), 'Réévaluation demandée')}><RefreshCw size={18} strokeWidth={1.75} />{job ? 'En file' : 'Réévaluer'}</Button>
        </div>

        <Section title="Garde" action={row && <GardeBadge status={row.garde} />}>
          <Card className={`p-4 ${u('drink_from') || u('drink_until') ? 'ring-2 ring-warn' : ''}`}><GardeFrise wine={wine} /></Card>
        </Section>

        <Section title="Prix de marché">
          <Card className="p-4">
            {price ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="tnum font-display text-[24px]">{eurRange(price.low_eur, price.high_eur)}</span>
                  <span className="text-[14px] text-muted">la bouteille</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[14px] text-muted">
                  <span>Confiance {pct(price.confidence)}</span>
                  <span>Vu le {date(price.checked_at)}</span>
                </div>
                {qty > 0 && price.low_eur != null && (
                  <div className="mt-2 text-[15px]">Valeur de la ligne : <b className="tnum">{eurRange(price.low_eur * qty, (price.high_eur ?? price.low_eur) * qty)}</b>
                    {row?.unitCost != null && <span className="text-muted"> · payé {eur(row.unitCost * qty)}</span>}</div>
                )}
                {price.sources.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {price.sources.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="flex min-h-9 items-center gap-1.5 text-[14px] text-primary">
                        <ExternalLink size={14} />{s.label ?? new URL(s.url).hostname}{s.checked_at ? <span className="text-muted"> · {date(s.checked_at)}</span> : null}</a></li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="text-[15px] text-muted">Pas encore estimé.</p>}
          </Card>
        </Section>

        <Section title="Service et accords">
          <Card className="p-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
              <span className={`flex items-center gap-1.5 ${u('serving_temp_c') ? 'text-warn' : ''}`}><Thermometer size={18} strokeWidth={1.75} />{wine.serving_temp_c != null ? `${wine.serving_temp_c} °C` : '—'}</span>
              <span className="flex items-center gap-1.5"><Timer size={18} strokeWidth={1.75} />{wine.decant_min ? `Carafer ${wine.decant_min} min` : 'Sans carafage'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {wine.pairings.length ? wine.pairings.map((p) => <Pill key={p} tone="primary">{dishLabel(p)}</Pill>) : <span className="text-[15px] text-muted">Accords pas encore renseignés.</span>}
            </div>
          </Card>
        </Section>

        <Section title="État des bouteilles">
          <div className="space-y-2">
            {lots.map((l) => (
              <Card key={l.id} className="p-3" onClick={() => setLotEdit(l)}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Clayette {shelfNo(l.shelf_id) ?? '—'} · {l.quantity} btl</span>
                  <Pencil size={16} className="text-muted" />
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-[14px]">
                  <dt className="text-muted">Niveau</dt><dd className={l.fill_level === 'bas_epaule' ? 'text-danger' : ''}>{fillLabel(l.fill_level)}</dd>
                  <dt className="text-muted">Étiquette</dt><dd>{l.label_condition ?? '—'}</dd>
                  <dt className="text-muted">Capsule, bouchon</dt><dd>{l.capsule_cork_condition ?? '—'}</dd>
                  <dt className="text-muted">Provenance</dt><dd>{l.provenance ?? '—'}</dd>
                </dl>
              </Card>
            ))}
            {!lots.length && <Empty>Plus de bouteille en cave.</Empty>}
          </div>
        </Section>

        <Section title="Historique">
          <Card className="divide-y divide-line">
            {[
              ...purchases.map((p) => ({ k: p.id, d: p.date, t: `Achat · ${p.quantity} btl${p.unit_price_eur != null ? ` à ${eur(p.unit_price_eur)}` : ''}${p.fees_eur ? ` + ${eur(p.fees_eur)} de frais` : ''}`, s: sourceLabel(p.source) })),
              ...exits.map((m) => ({ k: m.id, d: m.date, t: `Sortie · ${m.quantity} btl`, s: m.reason ?? '' })),
              ...tastings.map((t) => ({ k: t.id, d: t.date, t: `Dégustation${t.score_20 != null ? ` · ${String(t.score_20).replace('.', ',')}/20` : ''}`, s: [t.notes, t.dish_type && dishLabel(t.dish_type)].filter(Boolean).join(' — ') })),
            ].sort((a, b) => b.d.localeCompare(a.d)).map((e) => (
              <div key={e.k} className="px-4 py-2.5">
                <div className="flex justify-between gap-2 text-[15px]"><span>{e.t}</span><span className="shrink-0 text-[13px] text-muted">{date(e.d)}</span></div>
                {e.s && <div className="text-[14px] text-muted">{e.s}</div>}
              </div>
            ))}
            {!purchases.length && !exits.length && !tastings.length && <div className="p-4 text-[15px] text-muted">Rien pour l’instant.</div>}
          </Card>
        </Section>
        {wine.notes && <Section title="Notes"><Card className="p-4 text-[15px]">{wine.notes}</Card></Section>}
        <div className="h-6" />
      </div>

      {row && <TakeBottleSheet row={taking ? { ...row, lots } : null} onClose={() => setTaking(false)} />}
      <EditWineSheet wine={wine} open={editing} onClose={() => setEditing(false)} />
      <LotSheet lot={lotEdit} onClose={() => setLotEdit(null)} />
      <MoveSheet lot={moving} lots={lots} onClose={() => setMoving(null)} />
    </>
  )
}

function PhotoStrip({ paths, color }: { paths: string[]; color: Wine['color'] }) {
  const [open, setOpen] = useState<string | null>(null)
  const url = usePhotoUrl(open)
  return (
    <>
      <button className="shrink-0" onClick={() => paths[0] && setOpen(paths[0])} aria-label="Agrandir la photo">
        <Thumb path={paths[0]} color={color} className="w-28" />
      </button>
      {open && (
        <div className="fade-in fixed inset-0 z-50 flex flex-col bg-black/90 pt-safe" onClick={() => setOpen(null)}>
          <div className="flex flex-1 items-center justify-center p-4">{url && <img src={url} alt="Étiquette" className="max-h-full max-w-full object-contain" />}</div>
          {paths.length > 1 && (
            <div className="pb-safe flex justify-center gap-2 p-3" onClick={(e) => e.stopPropagation()}>
              {paths.map((p) => <button key={p} onClick={() => setOpen(p)} className={open === p ? 'ring-2 ring-white rounded-thumb' : ''}><Thumb path={p} className="w-12" /></button>)}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function EditWineSheet({ wine, open, onClose }: { wine: Wine; open: boolean; onClose: () => void }) {
  const { act } = useStore()
  const [w, setW] = useState(wine)
  const [prev, setPrev] = useState(open)
  if (open !== prev) { setPrev(open); if (open) setW(wine) }
  const set = <K extends keyof Wine>(k: K, v: Wine[K]) => setW({ ...w, [k]: v })
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const u = (f: string) => isUncertain(wine, f)
  const text = (k: keyof Wine, label: string) => (
    <Field label={label} warn={u(k)}>
      <input className={`field ${u(k) ? 'uncertain' : ''}`} value={(w[k] as string) ?? ''} onChange={(e) => set(k, (e.target.value || null) as never)} />
    </Field>
  )
  const year = (k: keyof Wine, label: string) => (
    <Field label={label} warn={u(k)}>
      <input className={`field tnum ${u(k) ? 'uncertain' : ''}`} inputMode="numeric" value={(w[k] as number) ?? ''} onChange={(e) => set(k, num(e.target.value) as never)} />
    </Field>
  )
  const save = async () => {
    // Une correction manuelle vaut validation : confiance pleine sur les champs modifiés.
    const confidence = { ...w.confidence }
    for (const k of Object.keys(w) as (keyof Wine)[]) if (JSON.stringify(w[k]) !== JSON.stringify(wine[k])) confidence[k] = 1
    const { id: _id, created_at: _c, updated_at: _u, ...patch } = w
    await act((a) => a.updateWine(wine.id, { ...patch, confidence }), 'Fiche enregistrée')
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Modifier la fiche">
      {text('producer', 'Domaine')}
      {text('cuvee', 'Cuvée')}
      {text('appellation', 'Appellation')}
      {text('classification', 'Classement')}
      <div className="grid grid-cols-2 gap-2">{text('region', 'Région')}{text('country', 'Pays')}</div>
      <div className="grid grid-cols-2 gap-2">{year('vintage', 'Millésime')}{year('bottle_size_cl', 'Format (cl)')}</div>
      <Field label="Couleur" warn={u('color')}><Segmented value={w.color ?? ('' as never)} onChange={(c) => set('color', c)} wrap options={COLORS} /></Field>
      <Field label="Cépages (séparés par des virgules)" warn={u('grapes')}>
        <input className={`field ${u('grapes') ? 'uncertain' : ''}`} value={w.grapes.join(', ')} onChange={(e) => set('grapes', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <div className="grid grid-cols-3 gap-2">{year('drink_from', 'Boire dès')}{year('drink_peak', 'Apogée')}{year('drink_until', 'Jusqu’à')}</div>
      <div className="grid grid-cols-2 gap-2">{year('serving_temp_c', 'Service (°C)')}{year('decant_min', 'Carafage (min)')}</div>
      <Field label="Accords">
        <div className="flex flex-wrap gap-1.5">
          {DISHES.map((dsh) => {
            const on = w.pairings.includes(dsh.id)
            return <button type="button" key={dsh.id} onClick={() => set('pairings', on ? w.pairings.filter((p) => p !== dsh.id) : [...w.pairings, dsh.id])}
              className={`min-h-11 rounded-full px-3.5 text-[15px] ${on ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>{dsh.label}</button>
          })}
        </div>
      </Field>
      <Field label="Notes"><textarea className="field min-h-20" value={w.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></Field>
      <Button className="w-full" onClick={save}>Enregistrer</Button>
    </Sheet>
  )
}

function LotSheet({ lot, onClose }: { lot: StockLot | null; onClose: () => void }) {
  const { act } = useStore()
  const [l, setL] = useState<StockLot | null>(lot)
  if (lot && l?.id !== lot.id) setL(lot)
  if (!lot || !l) return null
  const save = async () => {
    await act((a) => a.updateStockLot(l.id, { fill_level: l.fill_level, label_condition: l.label_condition, capsule_cork_condition: l.capsule_cork_condition, provenance: l.provenance }), 'État enregistré')
    onClose()
  }
  return (
    <Sheet open onClose={onClose} title="État des bouteilles">
      <Field label="Niveau"><Segmented<FillLevel | ''> value={l.fill_level ?? ''} onChange={(v) => setL({ ...l, fill_level: (v || null) as FillLevel | null })} wrap options={[...FILL_LEVELS]} /></Field>
      <Field label="Étiquette"><input className="field" placeholder="Parfaite, tachée, déchirée…" value={l.label_condition ?? ''} onChange={(e) => setL({ ...l, label_condition: e.target.value || null })} /></Field>
      <Field label="Capsule et bouchon"><input className="field" placeholder="Intacte, bouchon qui remonte…" value={l.capsule_cork_condition ?? ''} onChange={(e) => setL({ ...l, capsule_cork_condition: e.target.value || null })} /></Field>
      <Field label="Provenance et stockage connus"><textarea className="field min-h-20" value={l.provenance ?? ''} onChange={(e) => setL({ ...l, provenance: e.target.value || null })} /></Field>
      <Button className="w-full" onClick={save}>Enregistrer</Button>
    </Sheet>
  )
}

function MoveSheet({ lot, lots, onClose }: { lot: StockLot | null; lots: StockLot[]; onClose: () => void }) {
  const { data, act } = useStore()
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [qty, setQty] = useState(1)
  const [prev, setPrev] = useState<StockLot | null>(null)
  if (lot !== prev) { setPrev(lot); if (lot) { setFrom(lot.id); setTo(''); setQty(lot.quantity) } }
  if (!lot) return null
  const src = lots.find((l) => l.id === from) ?? lot
  const shelves = data!.shelves
  return (
    <Sheet open onClose={onClose} title="Déplacer">
      {lots.length > 1 && (
        <Field label="Depuis">
          <select className="field" value={from} onChange={(e) => { setFrom(e.target.value); setQty(lots.find((l) => l.id === e.target.value)!.quantity) }}>
            {lots.map((l) => <option key={l.id} value={l.id}>Clayette {shelves.find((s) => s.id === l.shelf_id)?.shelf_number ?? '—'} — {l.quantity} btl</option>)}
          </select>
        </Field>
      )}
      <Field label="Vers la clayette">
        <Segmented value={to} onChange={setTo} wrap options={shelves.filter((s) => s.id !== src.shelf_id).map((s) => ({ id: s.id, label: String(s.shelf_number) }))} />
      </Field>
      <Field label="Quantité"><Stepper value={qty} onChange={setQty} max={src.quantity} /></Field>
      <Button className="w-full" disabled={!to} onClick={async () => { await act((a) => a.moveBottles(src.id, to, qty), 'Déplacé'); onClose() }}>Déplacer</Button>
    </Sheet>
  )
}
