import { ClipboardPaste, Hourglass, Link2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Empty, ICON, PageHeader, Pill, Segmented, VerdictBadge } from '../components/ui'
import { daysUntil, dateShort, eur, plural } from '../lib/format'
import { calibration, sortByInterest } from '../lib/hunt'
import { useStore } from '../lib/store'
import type { HuntLot } from '../lib/types'

type Tab = 'actifs' | 'a_viser' | 'archives'

export default function Hunt() {
  const { data, act, online } = useStore()
  const nav = useNavigate()
  const d = data!
  const [url, setUrl] = useState('')
  const [tab, setTab] = useState<Tab>('actifs')
  const pending = d.jobs.filter((j) => j.type === 'lot_url' && j.status !== 'fait')
  const cal = calibration(d.huntLots, d.settings.default_fees_rate)

  const lots = useMemo(() => {
    const isArchived = (h: HuntLot) => h.status === 'achete' || h.status === 'ignore' || (h.sale_date != null && daysUntil(h.sale_date) < 0)
    return d.huntLots
      .filter((h) => (tab === 'archives' ? isArchived(h) : !isArchived(h) && (tab === 'actifs' || h.verdict === 'a_viser')))
      .sort(tab === 'archives' ? (a, b) => (b.sale_date ?? '').localeCompare(a.sale_date ?? '') : sortByInterest)
  }, [d.huntLots, tab])

  const valid = /^https?:\/\/\S+\.\S+/.test(url.trim())
  const submit = async () => {
    if (!valid) return
    const r = await act((a) => a.pasteLotUrl(url.trim()), 'Lien ajouté à la file')
    if (r !== undefined) setUrl('')
  }
  const paste = async () => {
    try { setUrl((await navigator.clipboard.readText()).trim()) } catch { /* refusé : saisie manuelle */ }
  }

  return (
    <>
      <PageHeader title="Chasse" />
      <div className="px-safe">
        <Card className="p-3">
          <label htmlFor="lot-url" className="mb-1.5 flex items-center gap-1.5 text-[14px] font-medium text-muted"><Link2 size={16} />Coller un lien de vente</label>
          <div className="flex gap-2">
            <input id="lot-url" className="field" type="url" inputMode="url" placeholder="https://www.interencheres.com/…" value={url}
              onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            {!url && 'clipboard' in navigator && 'readText' in navigator.clipboard ? (
              <Button variant="secondary" className="!px-3" onClick={paste} aria-label="Coller"><ClipboardPaste {...ICON} /></Button>
            ) : (
              <Button className="!px-4" disabled={!valid || !online} onClick={submit}>Analyser</Button>
            )}
          </div>
          {pending.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pending.map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-[14px]">
                  {j.status === 'erreur' ? <TriangleAlert size={16} className="shrink-0 text-danger" /> : <Hourglass size={16} className="shrink-0 text-accent" />}
                  <span className="truncate text-muted">{String(j.payload.url ?? '')}</span>
                  {j.status === 'erreur' && <button className="ml-auto shrink-0 text-primary" onClick={() => act((a) => a.retryJob(j.id), 'Relancé')}>Relancer</button>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="mt-4"><Segmented<Tab> value={tab} onChange={setTab} options={[{ id: 'actifs', label: 'En cours' }, { id: 'a_viser', label: 'À viser' }, { id: 'archives', label: 'Archives' }]} /></div>

        <div className="mt-3 space-y-2">
          {lots.map((h) => <LotRow key={h.id} lot={h} onClick={() => nav(`/chasse/${h.id}`)} />)}
          {!lots.length && <Empty>{tab === 'archives' ? 'Aucun lot archivé.' : 'Colle le lien d’une vente : les lots arrivent au prochain passage.'}</Empty>}
        </div>

        <Card className="mt-6 p-4">
          <h2 className="text-[17px]">Calibrage</h2>
          {cal.ready ? (
            <p className="mt-1 text-[15px]">
              Sur {cal.count} ventes, le prix réel frais compris est en moyenne <b className="tnum">{cal.meanAbs >= 0 ? '+' : ''}{eur(cal.meanAbs)}</b> ({cal.meanRel >= 0 ? '+' : ''}{Math.round(cal.meanRel * 100)} %) par rapport au prix conseillé.
              {' '}{cal.above} fois au-dessus. {cal.meanRel > 0.05 ? 'Les conseils sont un peu optimistes : relève le taux de frais ou les seuils.' : cal.meanRel < -0.1 ? 'Les conseils sont prudents : tu peux viser plus large.' : 'Les conseils sont bien calés.'}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted">Saisis le prix d’adjudication après chaque vente, même non achetée. Le calibrage s’affiche à partir de 10 ventes ({cal.count}/10).</p>
          )}
        </Card>
        <div className="h-6" />
      </div>
    </>
  )
}

function LotRow({ lot: h, onClick }: { lot: HuntLot; onClick: () => void }) {
  const days = h.sale_date ? daysUntil(h.sale_date) : null
  return (
    <Card className="flex gap-3 p-3" onClick={onClick}>
      <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-thumb bg-surface-2">
        <span className="tnum font-display text-[20px] leading-none">{h.score ?? '–'}</span>
        <span className="text-[11px] text-muted">/100</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><VerdictBadge verdict={h.verdict} />{h.status === 'suivi' && <Pill tone="primary">Suivi</Pill>}{h.status === 'achete' && <Pill tone="ok">Acheté</Pill>}</div>
        <div className="mt-1 truncate font-medium">{h.title ?? h.description ?? 'Lot'}</div>
        <div className="truncate text-[13px] text-muted">
          {[h.sale_house, h.sale_date && `${dateShort(h.sale_date)}${days != null && days >= 0 ? ` (${days === 0 ? 'aujourd’hui' : `J-${days}`})` : ''}`, h.location].filter(Boolean).join(' · ')}
        </div>
        <div className="tnum mt-0.5 text-[14px]">
          {h.hammer_price_eur != null ? <>Adjugé {eur(h.hammer_price_eur)}</> : h.max_total_eur != null ? <>Max conseillé <b>{eur(h.max_total_eur)}</b> frais compris</> : h.estimate_low_eur != null ? <>Estimation {eur(h.estimate_low_eur)}</> : null}
          {h.score_detail?.bottles ? <span className="text-muted"> · {plural(h.score_detail.bottles, 'btl', 'btl')}</span> : null}
        </div>
      </div>
    </Card>
  )
}
