import { Bookmark, BookmarkCheck, ExternalLink, EyeOff, PackagePlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Empty, Field, ICON, PageHeader, Pill, Section, Segmented, Sheet, VerdictBadge, VintageBadge, WineDot } from '../components/ui'
import { colorLabel, fillLabel } from '../lib/constants'
import { date, daysUntil, eur, eurRange, pct } from '../lib/format'
import { useStore } from '../lib/store'

export default function HuntLotPage() {
  const { id } = useParams()
  const { data, act } = useStore()
  const nav = useNavigate()
  const d = data!
  const h = d.huntLots.find((x) => x.id === id)
  const [hammer, setHammer] = useState('')
  const [buying, setBuying] = useState(false)
  const [shelf, setShelf] = useState('')
  const [fees, setFees] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  if (!h) return (<><PageHeader title="Lot" back /><div className="px-safe"><Empty>Lot introuvable.</Empty></div></>)

  const wines = d.huntLotWines.filter((w) => w.hunt_lot_id === h.id)
  const sd = h.score_detail ?? {}
  const feesRate = h.fees_rate ?? d.settings.default_fees_rate
  const saleDone = h.sale_date != null && daysUntil(h.sale_date) < 0
  const w = d.settings.weights
  const parts = [
    { k: 'discount', label: 'Décote', v: sd.discount, max: w.discount },
    { k: 'gap', label: 'Manque comblé', v: sd.gap, max: w.gap },
    { k: 'affinity', label: 'Affinité', v: sd.affinity, max: w.affinity },
    { k: 'info', label: 'Qualité de l’info', v: sd.info, max: w.info },
  ]
  const num = (s: string) => Number(s.replace(',', '.').replace(/\s/g, ''))

  return (
    <>
      <PageHeader title={h.title ?? 'Lot'} back />
      <div className="px-safe">
        {h.photos.length > 0 && (
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
            {h.photos.map((p) => (
              <button key={p} onClick={() => setPhoto(p)} className="aspect-[4/3] w-48 shrink-0 overflow-hidden rounded-card bg-surface-2">
                <img src={p} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={h.verdict} />
          {h.score != null && <span className="tnum font-display text-[20px]">{h.score}<span className="text-[14px] text-muted">/100</span></span>}
          {h.status === 'achete' && <Pill tone="ok">Acheté</Pill>}
        </div>
        {h.reason && <p className="mt-2 text-[15px]">{h.reason}</p>}

        <Card className="mt-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[13px] text-muted">Prix max conseillé</div>
              <div className="tnum font-display text-[22px]">{eur(h.max_total_eur)}</div>
              <div className="text-[13px] text-muted">frais compris</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Enchère max</div>
              <div className="tnum font-display text-[22px]">{eur(h.max_bid_eur)}</div>
              <div className="text-[13px] text-muted">hors frais ({pct(feesRate)})</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Estimation maison</div>
              <div className="tnum text-[17px]">{eurRange(h.estimate_low_eur, h.estimate_high_eur)}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Marché</div>
              <div className="tnum text-[17px]">{eurRange(sd.market_low, sd.market_high)}</div>
              {sd.confidence != null && <div className="text-[13px] text-muted">confiance {pct(sd.confidence)}</div>}
            </div>
          </div>
          {parts.some((p) => p.v != null) && (
            <div className="mt-4 space-y-1.5">
              {parts.map((p) => (
                <div key={p.k} className="flex items-center gap-2 text-[14px]">
                  <span className="w-32 shrink-0 text-muted">{p.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${((p.v ?? 0) / p.max) * 100}%` }} /></div>
                  <span className="tnum w-12 text-right">{Math.round(p.v ?? 0)}/{p.max}</span>
                </div>
              ))}
            </div>
          )}
          {h.gap_filled && <p className="mt-3 text-[14px]">Années en manque comblées : <b>{h.gap_filled}</b></p>}
        </Card>

        <Section title="Vente">
          <Card className="p-4 text-[15px]">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Maison</dt><dd>{h.sale_house ?? '—'}{h.lot_number ? ` · lot ${h.lot_number}` : ''}</dd>
              <dt className="text-muted">Vente</dt><dd>{date(h.sale_date)}</dd>
              <dt className="text-muted">Retrait</dt><dd>{date(h.pickup_date)}</dd>
              <dt className="text-muted">Lieu</dt><dd>{h.location ?? '—'}</dd>
              {h.provenance && <><dt className="text-muted">Provenance</dt><dd>{h.provenance}</dd></>}
            </dl>
            {h.description && <p className="mt-3 whitespace-pre-line text-muted">{h.description}</p>}
            {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="mt-2 flex min-h-11 items-center gap-1.5 text-primary"><ExternalLink size={16} />Voir l’annonce</a>}
          </Card>
        </Section>

        <Section title={`Vins du lot (${wines.reduce((s, x) => s + x.quantity, 0)} btl)`}>
          <div className="space-y-2">
            {wines.map((x) => (
              <Card key={x.id} className="p-3">
                <div className="flex items-center gap-1.5">
                  <WineDot color={x.color} />
                  <span className="flex-1 truncate font-medium">{x.producer ?? x.appellation}</span>
                  <VintageBadge vintage={x.vintage} />
                  <span className="tnum w-8 text-right font-semibold">×{x.quantity}</span>
                </div>
                <div className="text-[14px] text-muted">{[x.cuvee, x.appellation, colorLabel(x.color), x.bottle_size_cl !== 75 && `${x.bottle_size_cl} cl`].filter(Boolean).join(' · ')}</div>
                <div className="mt-1 text-[14px]">
                  <span className={x.fill_level === 'bas_epaule' ? 'text-danger' : ''}>{fillLabel(x.fill_level)}</span>
                  {x.cork_rising && <span className="text-danger"> · bouchon qui remonte</span>}
                  {x.condition_notes && <span className="text-muted"> · {x.condition_notes}</span>}
                </div>
                <div className="tnum mt-1 flex flex-wrap gap-x-3 text-[14px] text-muted">
                  {x.drink_from != null && <span>À boire {x.drink_from}–{x.drink_until}</span>}
                  {x.market_low_eur != null && <span>Marché {eurRange(x.market_low_eur, x.market_high_eur)} / btl</span>}
                </div>
                {x.market_sources?.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3">
                    {x.market_sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex min-h-9 items-center gap-1 text-[13px] text-primary"><ExternalLink size={12} />{s.label ?? new URL(s.url).hostname}</a>)}
                  </div>
                )}
              </Card>
            ))}
            {!wines.length && <Empty>Vins pas encore extraits.</Empty>}
          </div>
        </Section>

        {h.status !== 'achete' && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => act((a) => a.updateHuntLot(h.id, { status: h.status === 'suivi' ? 'nouveau' : 'suivi' }), h.status === 'suivi' ? 'Plus suivi' : 'Lot suivi')}>
                {h.status === 'suivi' ? <><BookmarkCheck {...ICON} />Suivi</> : <><Bookmark {...ICON} />Suivre</>}
              </Button>
              <Button variant="secondary" onClick={async () => { await act((a) => a.updateHuntLot(h.id, { status: h.status === 'ignore' ? 'nouveau' : 'ignore' })); if (h.status !== 'ignore') nav(-1) }}>
                <EyeOff {...ICON} />{h.status === 'ignore' ? 'Rétablir' : 'Ignorer'}
              </Button>
            </div>
            <Section title="Après la vente">
              <Card className="p-4">
                <Field label="Prix d’adjudication (€, hors frais)" hint="Même pour un lot non acheté : c’est ce qui calibre les conseils.">
                  <div className="flex gap-2">
                    <input className="field tnum" inputMode="decimal" placeholder={h.hammer_price_eur != null ? String(h.hammer_price_eur) : saleDone ? 'Adjugé à…' : 'Après la vente'} value={hammer} onChange={(e) => setHammer(e.target.value)} />
                    <Button className="!px-4" disabled={!hammer} onClick={async () => { await act((a) => a.updateHuntLot(h.id, { hammer_price_eur: num(hammer) }), 'Prix enregistré'); setHammer('') }}>OK</Button>
                  </div>
                </Field>
                <Field label="Frais acheteur de cette vente (%)" hint={`Par défaut ${pct(d.settings.default_fees_rate)}`}>
                  <div className="flex gap-2">
                    <input className="field tnum" inputMode="decimal" placeholder={h.fees_rate != null ? String(Math.round(h.fees_rate * 1000) / 10) : 'Par défaut'} value={fees} onChange={(e) => setFees(e.target.value)} />
                    <Button variant="secondary" className="!px-4" disabled={!fees} onClick={async () => { await act((a) => a.updateHuntLot(h.id, { fees_rate: num(fees) / 100 }), 'Frais enregistrés, score recalculé'); setFees('') }}>OK</Button>
                  </div>
                </Field>
                <Button className="w-full" disabled={!wines.length} onClick={() => { setHammer(h.hammer_price_eur != null ? String(h.hammer_price_eur) : ''); setBuying(true) }}><PackagePlus {...ICON} />Je l’ai acheté</Button>
              </Card>
            </Section>
          </>
        )}
        {h.status === 'achete' && (
          <Card className="mt-5 p-4 text-[15px]">Acheté {eur(h.hammer_price_eur)} hors frais, bouteilles ajoutées à la cave. <button className="text-primary" onClick={() => nav('/cave?q=')}>Voir la cave</button></Card>
        )}
        <div className="h-6" />
      </div>

      <Sheet open={buying} onClose={() => setBuying(false)} title="Ajouter à la cave">
        <p className="mb-3 text-[15px] text-muted">Les {wines.reduce((s, x) => s + x.quantity, 0)} bouteilles entrent en cave avec le prix payé et l’état déclaré.</p>
        <Field label="Prix d’adjudication (€, hors frais)" hint={hammer ? `Soit ${eur(num(hammer) * (1 + feesRate))} frais compris` : undefined}>
          <input className="field tnum" inputMode="decimal" value={hammer} onChange={(e) => setHammer(e.target.value)} />
        </Field>
        <Field label="Clayette">
          <Segmented value={shelf} onChange={setShelf} wrap options={[{ id: '', label: '—' }, ...d.shelves.map((s) => ({ id: s.id, label: String(s.shelf_number) }))]} />
        </Field>
        <Button className="w-full" disabled={!hammer} onClick={async () => {
          const n = await act((a) => a.convertHuntLot(h.id, num(hammer), shelf || null))
          if (n != null) { setBuying(false); nav('/cave') }
        }}>Ajouter à la cave</Button>
      </Sheet>

      {photo && (
        <div className="fade-in pt-safe fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </>
  )
}
