import { CheckCircle2, Hourglass, Loader, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader, Section } from '../components/ui'
import { nextRun, wineTitle } from '../lib/cellar'
import { date } from '../lib/format'
import { useStore } from '../lib/store'
import type { AiJob } from '../lib/types'

const TYPE: Record<AiJob['type'], string> = {
  label: 'Lecture d’étiquette',
  enrich: 'Garde, accords et prix',
  lot_url: 'Analyse d’une vente',
  revalue: 'Revalorisation mensuelle',
  feasibility: 'Essai de faisabilité',
}

export default function AiQueue() {
  const { data, act } = useStore()
  const nav = useNavigate()
  const d = data!
  const wines = new Map(d.wines.map((w) => [w.id, w]))
  const next = nextRun(d.settings.ai_run_hours)
  const open = d.jobs.filter((j) => j.status !== 'fait')
  const done = d.jobs.filter((j) => j.status === 'fait').slice(0, 30)

  const row = (j: AiJob) => {
    const w = j.ref_id ? wines.get(j.ref_id) : undefined
    const Icon = j.status === 'erreur' ? TriangleAlert : j.status === 'en_cours' ? Loader : j.status === 'fait' ? CheckCircle2 : Hourglass
    const tone = j.status === 'erreur' ? 'text-danger' : j.status === 'fait' ? 'text-ok' : 'text-accent'
    return (
      <div key={j.id} className="flex gap-3 px-4 py-2.5">
        <Icon size={18} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1 text-[15px]">
          <div>{TYPE[j.type]}</div>
          <div className="truncate text-[13px] text-muted">
            {w ? <button className="text-primary" onClick={() => nav(`/vin/${w.id}`)}>{wineTitle(w)} {w.vintage ?? ''}</button> : j.payload?.url ? String(j.payload.url) : ''}
            {' · '}{date(j.done_at ?? j.created_at)}
          </div>
          {j.message && <div className={`text-[13px] ${j.status === 'erreur' ? 'text-danger' : 'text-muted'}`}>{j.message}</div>}
        </div>
        {j.status === 'erreur' && <button className="min-h-11 shrink-0 text-[15px] text-primary" onClick={() => act((a) => a.retryJob(j.id), 'Relancée')}>Relancer</button>}
      </div>
    )
  }

  return (
    <>
      <PageHeader title="File d’attente IA" back subtitle={`Prochain passage : ${next.toLocaleString('fr-FR', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`} />
      <div className="px-safe">
        <p className="text-[14px] text-muted">
          L’app ne fait aucun appel d’IA. La tâche Claude planifiée traite au plus {d.settings.ai_batch_size} demandes par passage ; tu peux aussi la lancer à la main depuis l’app Claude.
        </p>
        <Section title="En attente">{open.length ? <Card className="divide-y divide-line">{open.map(row)}</Card> : <Empty>Rien en attente.</Empty>}</Section>
        {done.length > 0 && <Section title="Traité ces 7 derniers jours"><Card className="divide-y divide-line">{done.map(row)}</Card></Section>}
        <div className="h-6" />
      </div>
    </>
  )
}
