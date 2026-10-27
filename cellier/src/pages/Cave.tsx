import { LayoutList, Rows3, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TakeBottleSheet } from '../components/TakeBottleSheet'
import { WineCard } from '../components/WineCard'
import { Button, Empty, Field, ICON, PageHeader, Segmented, Sheet, VintageBadge, WineDot } from '../components/ui'
import { COLORS } from '../lib/constants'
import { GARDE_LABEL, inWindow, matchesQuery, wineTitle, type CellarRow, type GardeStatus } from '../lib/cellar'
import { useStore } from '../lib/store'
import { bottlePrice } from '../lib/tonight'

type Sort = 'nom' | 'millesime' | 'urgence' | 'prix' | 'ajout'
interface Filters { color: string; region: string; appellation: string; vintage: string; garde: string; maxPrice: string }
const NO_FILTERS: Filters = { color: '', region: '', appellation: '', vintage: '', garde: '', maxPrice: '' }

export default function Cave() {
  const { data, rows } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get('vue') === 'armoire' ? 'armoire' : 'liste'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [sort, setSort] = useState<Sort>('urgence')
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, garde: params.get('garde') ?? '' })
  const [showFilters, setShowFilters] = useState(false)
  const [taking, setTaking] = useState<CellarRow | null>(null)
  const shelfRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const opts = useMemo(() => ({
    regions: [...new Set(rows.map((r) => r.wine.region).filter(Boolean) as string[])].sort(),
    appellations: [...new Set(rows.map((r) => r.wine.appellation).filter(Boolean) as string[])].sort(),
    vintages: [...new Set(rows.map((r) => r.wine.vintage).filter(Boolean) as number[])].sort((a, b) => b - a),
  }), [rows])

  const filtered = useMemo(() => {
    const f = filters
    const max = f.maxPrice ? Number(f.maxPrice) : null
    const list = rows.filter((r) => {
      const w = r.wine
      if (!matchesQuery(r, q)) return false
      if (f.color && w.color !== f.color) return false
      if (f.region && w.region !== f.region) return false
      if (f.appellation && w.appellation !== f.appellation) return false
      if (f.vintage && String(w.vintage) !== f.vintage) return false
      if (f.garde === 'fenetre' && !inWindow(w)) return false
      if (f.garde && f.garde !== 'fenetre' && r.garde !== f.garde) return false
      if (max != null) {
        const p = bottlePrice(r)
        if (p == null || p > max) return false
      }
      return true
    })
    const cmp: Record<Sort, (a: CellarRow, b: CellarRow) => number> = {
      nom: (a, b) => wineTitle(a.wine).localeCompare(wineTitle(b.wine), 'fr'),
      millesime: (a, b) => (a.wine.vintage ?? 0) - (b.wine.vintage ?? 0),
      urgence: (a, b) => Number(b.pending) - Number(a.pending) || (a.wine.drink_until ?? 9999) - (b.wine.drink_until ?? 9999),
      prix: (a, b) => (bottlePrice(b) ?? -1) - (bottlePrice(a) ?? -1),
      ajout: (a, b) => (b.lots[0]?.added_at ?? '').localeCompare(a.lots[0]?.added_at ?? ''),
    }
    return list.sort(cmp[sort])
  }, [rows, q, filters, sort])

  const activeFilters = Object.values(filters).filter(Boolean).length
  const bottles = filtered.reduce((s, r) => s + r.quantity, 0)

  // Vue armoire : une ligne par clayette ; la recherche surligne la clayette trouvée.
  const shelves = data!.shelves
  const matchShelves = new Set(q.trim() ? filtered.flatMap((r) => r.lots.map((l) => l.shelf_id ?? 'none')) : [])
  useEffect(() => {
    if (view !== 'armoire' || !q.trim()) return
    const first = [...shelves.map((s) => s.id), 'none'].find((id) => matchShelves.has(id))
    if (first) shelfRefs.current[first]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, view])

  const setView = (v: string) => {
    const p = new URLSearchParams(params)
    p.set('vue', v)
    setParams(p, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Cave"
        subtitle={`${bottles} bouteille${bottles > 1 ? 's' : ''} · ${filtered.length} vin${filtered.length > 1 ? 's' : ''}`}
        right={
          <div className="flex rounded-full bg-surface-2 p-0.5">
            <button aria-label="Vue liste" onClick={() => setView('liste')} className={`flex h-10 w-11 items-center justify-center rounded-full ${view === 'liste' ? 'bg-surface text-primary shadow-card' : 'text-muted'}`}><LayoutList {...ICON} /></button>
            <button aria-label="Vue armoire" onClick={() => setView('armoire')} className={`flex h-10 w-11 items-center justify-center rounded-full ${view === 'armoire' ? 'bg-surface text-primary shadow-card' : 'text-muted'}`}><Rows3 {...ICON} /></button>
          </div>
        }
      />
      <div className="px-safe">
        <div className="sticky z-10 -mx-1 flex gap-2 bg-bg px-1 pb-2" style={{ top: 'calc(max(env(safe-area-inset-top), 12px) + 72px)' }}>
          <div className="relative flex-1">
            <input className="field pr-10" type="search" placeholder="Domaine, appellation, millésime…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button aria-label="Effacer" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted" onClick={() => setQ('')}><X size={18} /></button>}
          </div>
          <button aria-label="Filtres et tri" onClick={() => setShowFilters(true)} className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-primary">
            <SlidersHorizontal {...ICON} />
            {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">{activeFilters}</span>}
          </button>
        </div>

        {rows.length === 0 ? (
          <Empty>
            La cave est vide. <button className="text-primary underline" onClick={() => nav('/ajouter')}>Ajoute une première bouteille</button>.
          </Empty>
        ) : view === 'liste' ? (
          <div className="space-y-2">
            {filtered.map((r) => <WineCard key={r.wine.id} row={r} onTake={setTaking} />)}
            {!filtered.length && <Empty>Aucun vin ne correspond.</Empty>}
            {filtered.length > 0 && <p className="pt-1 text-center text-[13px] text-muted">Glisse une ligne vers la gauche pour sortir une bouteille.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {[...shelves, { id: 'none', shelf_number: 0, label: 'Sans clayette', capacity: null }].map((s) => {
              const items = filtered.flatMap((r) => r.lots.filter((l) => (l.shelf_id ?? 'none') === s.id).map((l) => ({ r, l })))
              if (s.id === 'none' && !items.length) return null
              const count = items.reduce((n, x) => n + x.l.quantity, 0)
              const hit = matchShelves.has(s.id)
              return (
                <div key={s.id} ref={(el) => { shelfRefs.current[s.id] = el }}
                  className={`rounded-card bg-surface p-3 shadow-card ${hit ? 'flash ring-2 ring-primary' : q.trim() ? 'opacity-50' : ''}`}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <h3 className="text-[17px]">{s.id === 'none' ? s.label : `Clayette ${s.shelf_number}`}{s.id !== 'none' && s.label ? <span className="font-sans text-[14px] font-normal text-muted"> · {s.label}</span> : null}</h3>
                    <span className="tnum text-[14px] text-muted">{count}{s.capacity ? ` / ${s.capacity}` : ''}</span>
                  </div>
                  {s.capacity ? (
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (count / s.capacity) * 100)}%` }} /></div>
                  ) : null}
                  {items.length ? (
                    <ul>
                      {items.map(({ r, l }) => (
                        <li key={l.id}>
                          <button className="flex min-h-11 w-full items-center gap-2 text-left" onClick={() => nav(`/vin/${r.wine.id}`)}>
                            <WineDot color={r.wine.color} />
                            <span className="min-w-0 flex-1 truncate text-[15px]">{wineTitle(r.wine)}{r.wine.cuvee ? ` · ${r.wine.cuvee}` : ''}</span>
                            <VintageBadge vintage={r.wine.vintage} />
                            <span className="tnum w-7 text-right text-[15px] font-semibold">{l.quantity}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[14px] text-muted">Vide</p>
                  )}
                </div>
              )
            })}
            {!shelves.length && <Empty>Décris ton armoire dans <button className="text-primary underline" onClick={() => nav('/reglages')}>les Réglages</button>.</Empty>}
          </div>
        )}
      </div>

      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filtres et tri">
        <Field label="Trier par">
          <Segmented<Sort> value={sort} onChange={setSort} wrap options={[
            { id: 'urgence', label: 'Urgence' }, { id: 'nom', label: 'Nom' }, { id: 'millesime', label: 'Millésime' },
            { id: 'prix', label: 'Prix' }, { id: 'ajout', label: 'Ajout récent' },
          ]} />
        </Field>
        <Field label="Couleur">
          <Segmented value={filters.color} onChange={(color) => setFilters({ ...filters, color })} wrap options={[{ id: '', label: 'Toutes' }, ...COLORS]} />
        </Field>
        <Field label="Statut de garde">
          <select className="field" value={filters.garde} onChange={(e) => setFilters({ ...filters, garde: e.target.value })}>
            <option value="">Tous</option>
            <option value="fenetre">Dans sa fenêtre</option>
            {(Object.keys(GARDE_LABEL) as GardeStatus[]).map((g) => <option key={g} value={g}>{GARDE_LABEL[g]}</option>)}
          </select>
        </Field>
        <Field label="Région">
          <select className="field" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })}>
            <option value="">Toutes</option>
            {opts.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Appellation">
          <select className="field" value={filters.appellation} onChange={(e) => setFilters({ ...filters, appellation: e.target.value })}>
            <option value="">Toutes</option>
            {opts.appellations.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <div className="flex gap-2">
          <Field label="Millésime">
            <select className="field" value={filters.vintage} onChange={(e) => setFilters({ ...filters, vintage: e.target.value })}>
              <option value="">Tous</option>
              {opts.vintages.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Prix max (€)">
            <input className="field tnum" inputMode="numeric" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setFilters(NO_FILTERS)}>Réinitialiser</Button>
          <Button className="flex-1" onClick={() => setShowFilters(false)}>Voir {filtered.length} vin{filtered.length > 1 ? 's' : ''}</Button>
        </div>
      </Sheet>

      <TakeBottleSheet row={taking} onClose={() => setTaking(null)} />
    </>
  )
}
