import { Card, Empty, PageHeader, Section, Stat } from '../components/ui'
import { cellarValue, colorShares, gapByYear, wineTitle } from '../lib/cellar'
import { colorLabel } from '../lib/constants'
import { date, eur } from '../lib/format'
import { useStore } from '../lib/store'
import type { Snapshot, WineColor } from '../lib/types'

export default function Value() {
  const { data, rows } = useStore()
  const d = data!
  const v = cellarValue(rows)
  const top = [...rows].filter((r) => r.price?.low_eur != null)
    .sort((a, b) => (b.price!.low_eur! * b.quantity) - (a.price!.low_eur! * a.quantity)).slice(0, 5)
  const gaps = gapByYear(rows, d.settings.monthly_consumption)
  const shares = colorShares(rows)
  const lastSnap = d.snapshots[d.snapshots.length - 1]

  return (
    <>
      <PageHeader title="Valeur de la cave" back />
      <div className="px-safe">
        <div className="flex gap-2">
          <Stat value={v.priced ? eur(v.mid) : '—'} label={`estimée (${eur(v.low)}–${eur(v.high)})`} />
          <Stat value={v.paid ? eur(v.paid) : '—'} label="payée" />
        </div>
        {v.paid > 0 && v.priced > 0 && (
          <p className="mt-2 text-[15px]">Écart avec le prix payé : <b className={`tnum ${v.mid >= v.paid ? 'text-ok' : 'text-danger'}`}>{v.mid >= v.paid ? '+' : ''}{eur(v.mid - v.paid)}</b>
            {v.priced < v.bottles && <span className="text-muted"> · {v.bottles - v.priced} bouteilles pas encore estimées</span>}</p>
        )}

        <Section title="Évolution">
          <Card className="p-4">
            {d.snapshots.length >= 2 ? <ValueChart snaps={d.snapshots} /> : <Empty>L’historique se construit avec la revalorisation mensuelle.</Empty>}
            {lastSnap && <p className="mt-2 text-[13px] text-muted">Dernière revalorisation le {date(lastSnap.date)}</p>}
          </Card>
        </Section>

        <Section title="Plus belles lignes">
          <Card className="divide-y divide-line">
            {top.map((r) => (
              <div key={r.wine.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[15px]">
                <span className="truncate">{wineTitle(r.wine)} {r.wine.vintage ?? ''} <span className="text-muted">×{r.quantity}</span></span>
                <span className="tnum shrink-0">{eur(r.price!.low_eur! * r.quantity)}</span>
              </div>
            ))}
            {!top.length && <div className="p-4 text-[15px] text-muted">Aucun prix encore.</div>}
          </Card>
        </Section>

        <Section title="Années à venir">
          <Card className="p-4">
            <p className="mb-3 text-[14px] text-muted">Bouteilles dans leur fenêtre, pour une cible de {gaps[0].target} par an ({d.settings.monthly_consumption} par mois).</p>
            <div className="flex h-32 items-end gap-1.5">
              {gaps.map((g) => (
                <div key={g.year} className="flex flex-1 flex-col items-center gap-1">
                  <span className="tnum text-[11px] text-muted">{g.bottles}</span>
                  <div className={`w-full rounded-t ${g.deficit ? 'bg-warn' : 'bg-ok'}`} style={{ height: `${Math.min(100, (g.bottles / g.target) * 100) * 0.8 + 2}px` }} />
                  <span className="tnum text-[11px] text-muted">{String(g.year).slice(2)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-muted">En ocre : années en manque, que le chasseur cherche à combler.</p>
          </Card>
        </Section>

        <Section title="Couleurs">
          <Card className="p-4">
            <div className="flex h-3 overflow-hidden rounded-full">
              {Object.entries(shares).map(([c, s]) => <div key={c} style={{ width: `${s * 100}%`, background: c === 'inconnu' ? 'var(--line)' : `var(--wine-${c})` }} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 text-[14px]">
              {Object.entries(shares).map(([c, s]) => <span key={c}>{c === 'inconnu' ? 'Inconnue' : colorLabel(c as WineColor)} {Math.round(s * 100)} %</span>)}
            </div>
          </Card>
        </Section>
        <div className="h-6" />
      </div>
    </>
  )
}

function ValueChart({ snaps }: { snaps: Snapshot[] }) {
  const W = 320, H = 140, P = 6
  const vals = snaps.flatMap((s) => [s.value_low_eur ?? 0, s.value_high_eur ?? 0, s.purchase_value_eur ?? 0])
  const max = Math.max(...vals) * 1.05, min = Math.min(...vals) * 0.95
  const x = (i: number) => P + (i / (snaps.length - 1)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P)
  const line = (f: (s: Snapshot) => number | null) => snaps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(s) ?? 0).toFixed(1)}`).join(' ')
  const band = `${line((s) => s.value_high_eur)} ${snaps.map((_, i) => `L${x(snaps.length - 1 - i).toFixed(1)},${y(snaps[snaps.length - 1 - i].value_low_eur ?? 0).toFixed(1)}`).join(' ')} Z`
  const last = snaps[snaps.length - 1]
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Valeur estimée et prix payé dans le temps">
        <path d={band} fill="var(--primary)" opacity="0.15" />
        <path d={line((s) => ((s.value_low_eur ?? 0) + (s.value_high_eur ?? 0)) / 2)} fill="none" stroke="var(--primary)" strokeWidth="2" />
        <path d={line((s) => s.purchase_value_eur)} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[13px] text-muted">
        <span>{date(snaps[0].date)}</span>
        <span><i className="mr-1 inline-block h-0.5 w-3 bg-primary align-middle" />Estimée {eur(((last.value_low_eur ?? 0) + (last.value_high_eur ?? 0)) / 2)} <i className="ml-2 mr-1 inline-block h-0.5 w-3 bg-accent align-middle" />Payée</span>
      </figcaption>
    </figure>
  )
}
