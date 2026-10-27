import { BookOpen, ChevronRight, Hourglass, LineChart, Settings, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card, ICON, PageHeader } from '../components/ui'
import { cellarValue } from '../lib/cellar'
import { eur } from '../lib/format'
import { useStore } from '../lib/store'

export default function More() {
  const nav = useNavigate()
  const { data, rows } = useStore()
  const v = cellarValue(rows)
  const items = [
    { to: '/journal', icon: BookOpen, label: 'Journal', sub: `${data!.tastings.length} dégustations` },
    { to: '/valeur', icon: LineChart, label: 'Valeur de la cave', sub: v.priced ? eur(v.mid) : 'Pas encore estimée' },
    { to: '/file-ia', icon: Hourglass, label: 'File d’attente IA', sub: `${data!.jobs.filter((j) => j.status === 'en_attente').length} en attente` },
    { to: '/reglages', icon: Settings, label: 'Réglages', sub: 'Armoire, budget, chasse, export, thème' },
    { to: '/installer?aide=1', icon: Smartphone, label: 'Installer sur l’iPhone', sub: 'Sur l’écran d’accueil, en plein écran' },
  ]
  return (
    <>
      <PageHeader title="Plus" />
      <div className="px-safe">
        <Card className="divide-y divide-line">
          {items.map(({ to, icon: Icon, label, sub }) => (
            <button key={to} onClick={() => nav(to)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
              <Icon {...ICON} className="text-primary" />
              <div className="flex-1"><div className="font-medium">{label}</div><div className="text-[13px] text-muted">{sub}</div></div>
              <ChevronRight {...ICON} className="text-muted" />
            </button>
          ))}
        </Card>
        <p className="mt-6 text-center text-[13px] text-muted">Cellier · version {__APP_VERSION__}</p>
      </div>
    </>
  )
}
