import { AlertTriangle, ChevronRight, Hourglass, Sparkles, Sunset } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { WineCard } from '../components/WineCard'
import { Button, Card, Empty, ICON, PageHeader, Section, Stat, VerdictBadge } from '../components/ui'
import { cellarValue, drinkNow, monthsCovered, nextRun, wineTitle, windowAlerts } from '../lib/cellar'
import { daysUntil, eur, plural } from '../lib/format'
import { useStore } from '../lib/store'

export default function Home() {
  const { data, rows } = useStore()
  const nav = useNavigate()
  const d = data!
  const value = cellarValue(rows)
  const now = drinkNow(rows)
  const alerts = windowAlerts(rows)
  const pending = d.jobs.filter((j) => j.status === 'en_attente' || j.status === 'en_cours')
  const photos = pending.filter((j) => j.type === 'label').length
  const links = pending.filter((j) => j.type === 'lot_url').length
  const others = pending.length - photos - links
  const errors = d.jobs.filter((j) => j.status === 'erreur').length
  const next = nextRun(d.settings.ai_run_hours)
  const soonLots = d.huntLots.filter((h) => (h.status === 'suivi' || h.verdict === 'a_viser') && h.status !== 'achete' && h.status !== 'ignore' && h.sale_date && daysUntil(h.sale_date) >= 0 && daysUntil(h.sale_date) < 7)
  const toVerify = d.wines.filter((w) => w.status === 'a_verifier' || w.merge_candidate_id)

  return (
    <>
      <PageHeader title="Cellier" />
      <div className="px-safe">
        <div className="flex gap-2">
          <Stat value={value.bottles} label="bouteilles en cave" />
          <Stat value={value.priced ? eur(value.mid) : '—'} label="valeur estimée" />
          <Stat value={monthsCovered(rows, d.settings.monthly_consumption).toFixed(0)} label={`mois à ${d.settings.monthly_consumption}/mois`} />
        </div>

        <Button className="mt-4 w-full !min-h-13 text-[17px]" onClick={() => nav('/ce-soir')}>
          <Sunset {...ICON} /> Quoi ouvrir ce soir
        </Button>

        <Section title="À boire maintenant" action={now.length > 3 && <button className="min-h-11 text-[15px] text-primary" onClick={() => nav('/cave?garde=fenetre')}>Tout voir</button>}>
          {now.length ? (
            <div className="space-y-2">{now.slice(0, 3).map((r) => <WineCard key={r.wine.id} row={r} />)}</div>
          ) : (
            <Empty>Aucune bouteille dans sa fenêtre pour l’instant.</Empty>
          )}
        </Section>

        <Section title="File d’attente IA">
          <Card className="flex items-center gap-3 p-3" onClick={() => nav('/file-ia')}>
            <Hourglass {...ICON} className="text-accent" />
            <div className="flex-1 text-[15px]">
              {pending.length ? (
                <>
                  {[photos && plural(photos, 'photo'), links && plural(links, 'lien'), others && plural(others, 'autre demande')].filter(Boolean).join(', ')} en attente
                  <div className="text-[13px] text-muted">Prochain passage {next.toDateString() === new Date().toDateString() ? 'aujourd’hui' : 'demain'} à {next.getHours()} h</div>
                </>
              ) : (
                <>Rien en attente<div className="text-[13px] text-muted">Prochain passage à {next.getHours()} h</div></>
              )}
              {errors > 0 && <div className="text-[13px] text-danger">{plural(errors, 'demande')} en erreur</div>}
            </div>
            <ChevronRight {...ICON} className="text-muted" />
          </Card>
        </Section>

        {(toVerify.length > 0 || alerts.entering.length + alerts.leaving.length + alerts.past.length > 0 || soonLots.length > 0) && (
          <Section title="Alertes">
            <div className="space-y-2">
              {toVerify.map((w) => (
                <Card key={w.id} className="flex items-center gap-3 p-3" onClick={() => nav(`/vin/${w.id}`)}>
                  <Sparkles {...ICON} className="text-warn" />
                  <div className="flex-1 text-[15px]">
                    {w.merge_candidate_id ? 'Fusion proposée' : 'Fiche à vérifier'} : {wineTitle(w)} {w.vintage ?? ''}
                  </div>
                  <ChevronRight {...ICON} className="text-muted" />
                </Card>
              ))}
              {alerts.leaving.map((r) => (
                <Card key={'l' + r.wine.id} className="flex items-center gap-3 p-3" onClick={() => nav(`/vin/${r.wine.id}`)}>
                  <AlertTriangle {...ICON} className="text-warn" />
                  <div className="flex-1 text-[15px]">Sort de sa fenêtre cette année : {wineTitle(r.wine)} {r.wine.vintage ?? ''} ({r.quantity})</div>
                </Card>
              ))}
              {alerts.entering.map((r) => (
                <Card key={'e' + r.wine.id} className="flex items-center gap-3 p-3" onClick={() => nav(`/vin/${r.wine.id}`)}>
                  <Sparkles {...ICON} className="text-ok" />
                  <div className="flex-1 text-[15px]">Entre dans sa fenêtre : {wineTitle(r.wine)} {r.wine.vintage ?? ''}</div>
                </Card>
              ))}
              {alerts.past.map((r) => (
                <Card key={'p' + r.wine.id} className="flex items-center gap-3 p-3" onClick={() => nav(`/vin/${r.wine.id}`)}>
                  <AlertTriangle {...ICON} className="text-danger" />
                  <div className="flex-1 text-[15px]">Fenêtre dépassée : {wineTitle(r.wine)} {r.wine.vintage ?? ''}</div>
                </Card>
              ))}
              {soonLots.map((h) => (
                <Card key={h.id} className="flex items-center gap-3 p-3" onClick={() => nav(`/chasse/${h.id}`)}>
                  <VerdictBadge verdict={h.verdict} />
                  <div className="min-w-0 flex-1 text-[15px]">
                    <div className="truncate">{h.title ?? h.sale_house}</div>
                    <div className="text-[13px] text-muted">Vente dans {plural(daysUntil(h.sale_date!), 'jour')}</div>
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        )}
        <div className="h-6" />
      </div>
    </>
  )
}
