import { Download, LogOut, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Field, ICON, PageHeader, Section, Segmented } from '../components/ui'
import { colorShares } from '../lib/cellar'
import { COLORS } from '../lib/constants'
import { resetDemo } from '../lib/demo'
import { cellarCsv, download, exportName } from '../lib/exportData'
import { clearCache, useStore } from '../lib/store'
import { DEMO, supabase } from '../lib/supabase'
import type { Settings, Shelf, WineColor } from '../lib/types'

export default function SettingsPage() {
  const { data, rows, act } = useStore()
  const d = data!
  const [s, setS] = useState<Settings>(d.settings)
  const [zone, setZone] = useState(d.settings.zone.join(', '))
  const [hours, setHours] = useState(d.settings.ai_run_hours.join(', '))
  const dirty = JSON.stringify({ ...s, zone: splitList(zone), ai_run_hours: splitNums(hours) }) !== JSON.stringify(d.settings)
  const n = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')))

  const save = async () => {
    const { owner: _o, ...rest } = s
    const r = await act((a) => a.saveSettings({ ...rest, zone: splitList(zone), ai_run_hours: splitNums(hours) }), 'Réglages enregistrés')
    if (r !== undefined) act((a) => a.rescore())
  }

  const setTheme = (theme: Settings['theme']) => {
    setS({ ...s, theme })
    act((a) => a.saveSettings({ theme }))
  }

  const num = (label: string, value: number, set: (v: number) => void, hint?: string, suffix?: string) => (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input className="field tnum" inputMode="decimal" defaultValue={String(value).replace('.', ',')} onChange={(e) => set(n(e.target.value))} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">{suffix}</span>}
      </div>
    </Field>
  )

  return (
    <>
      <PageHeader title="Réglages" back />
      <div className="px-safe">
        <Section title="Apparence">
          <Segmented<Settings['theme']> value={s.theme} onChange={setTheme} options={[{ id: 'system', label: 'Automatique' }, { id: 'light', label: 'Clair' }, { id: 'dark', label: 'Sombre' }]} />
        </Section>

        <Section title="Armoire"><ShelvesEditor shelves={d.shelves} /></Section>

        <Section title="Consommation">
          <Card className="p-4">
            {num('Bouteilles par mois', s.monthly_consumption, (v) => setS({ ...s, monthly_consumption: v }), `Soit ${Math.round(s.monthly_consumption * 12)} par an : une année avec moins de bouteilles en fenêtre est « en manque ».`)}
            <Field label="Cible par couleur (%)" hint="Vide = composition actuelle de la cave.">
              <div className="grid grid-cols-2 gap-2">
                {COLORS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-[14px]">
                    <span className="w-24 shrink-0">{c.label}</span>
                    <input className="field tnum" inputMode="numeric" value={s.color_targets[c.id] != null ? Math.round(s.color_targets[c.id]! * 100) : ''}
                      onChange={(e) => setS({ ...s, color_targets: withTarget(s.color_targets, c.id, e.target.value) })} />
                  </label>
                ))}
              </div>
            </Field>
            <Button variant="secondary" className="w-full" onClick={() => {
              const sh = colorShares(rows)
              setS({ ...s, color_targets: Object.fromEntries(COLORS.map((c) => [c.id, Math.round((sh[c.id] ?? 0) * 100) / 100])) })
            }}>Initialiser sur la cave actuelle</Button>
          </Card>
        </Section>

        <Section title="Chasse">
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-2">
              {num('Budget min par lot', s.budget_min, (v) => setS({ ...s, budget_min: v }), undefined, '€')}
              {num('Budget max par lot', s.budget_max, (v) => setS({ ...s, budget_max: v }), undefined, '€')}
            </div>
            <Field label="Zone de retrait" hint="Villes, départements ou régions acceptés, séparés par des virgules.">
              <textarea className="field min-h-20" value={zone} onChange={(e) => setZone(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {num('Horizon de veille', s.horizon_days, (v) => setS({ ...s, horizon_days: v }), undefined, 'j')}
              {num('Frais acheteur par défaut', Math.round(s.default_fees_rate * 1000) / 10, (v) => setS({ ...s, default_fees_rate: v / 100 }), undefined, '%')}
            </div>
            <p className="mb-2 mt-1 text-[14px] font-medium text-muted">Pondérations du score (total 100)</p>
            <div className="grid grid-cols-2 gap-2">
              {num('Décote', s.weights.discount, (v) => setS({ ...s, weights: { ...s.weights, discount: v } }))}
              {num('Manque comblé', s.weights.gap, (v) => setS({ ...s, weights: { ...s.weights, gap: v } }))}
              {num('Affinité', s.weights.affinity, (v) => setS({ ...s, weights: { ...s.weights, affinity: v } }))}
              {num('Qualité de l’info', s.weights.info, (v) => setS({ ...s, weights: { ...s.weights, info: v } }))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {num('« À viser » au-dessus de', s.thresholds.target, (v) => setS({ ...s, thresholds: { ...s.thresholds, target: v } }))}
              {num('« À surveiller » dès', s.thresholds.watch, (v) => setS({ ...s, thresholds: { ...s.thresholds, watch: v } }))}
            </div>
            {num('Affinité : note minimale du journal', s.affinity_min_score, (v) => setS({ ...s, affinity_min_score: v }), undefined, '/20')}
          </Card>
        </Section>

        <Section title="Tâche Claude">
          <Card className="p-4">
            <Field label="Heures de passage" hint="Doivent correspondre à la tâche planifiée dans Claude. Sert à afficher le prochain passage.">
              <input className="field tnum" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {num('Demandes par passage', s.ai_batch_size, (v) => setS({ ...s, ai_batch_size: v }))}
              {num('Validité des liens photo', s.photo_link_ttl_hours, (v) => setS({ ...s, photo_link_ttl_hours: v }), undefined, 'h')}
            </div>
          </Card>
        </Section>

        {dirty && (
          <div className="sticky z-10 mt-4" style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
            <Button className="w-full shadow-lg" onClick={save}>Enregistrer et recalculer les scores</Button>
          </div>
        )}

        <Section title="Export">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => download(exportName('csv'), cellarCsv(d), 'text/csv;charset=utf-8')}><Download {...ICON} />CSV</Button>
            <Button variant="secondary" onClick={() => download(exportName('json'), JSON.stringify(d, null, 2), 'application/json')}><Download {...ICON} />JSON complet</Button>
          </div>
        </Section>

        <Section title="Compte">
          {DEMO ? (
            <Button variant="secondary" className="w-full" onClick={() => { resetDemo(); clearCache(); location.reload() }}>Réinitialiser les données de démo</Button>
          ) : (
            <Button variant="secondary" className="w-full" onClick={async () => { await supabase!.auth.signOut(); clearCache(); location.reload() }}><LogOut {...ICON} />Se déconnecter</Button>
          )}
        </Section>
        <div className="h-8" />
      </div>
    </>
  )
}

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const splitNums = (s: string) => splitList(s).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h < 24)

function withTarget(t: Settings['color_targets'], c: WineColor, v: string) {
  const out = { ...t }
  if (v.trim() === '') delete out[c]
  else out[c] = Math.min(100, Number(v.replace(/\D/g, ''))) / 100
  return out
}

function ShelvesEditor({ shelves }: { shelves: Shelf[] }) {
  const { act } = useStore()
  const next = (shelves[shelves.length - 1]?.shelf_number ?? 0) + 1
  const [cap, setCap] = useState('')
  return (
    <Card className="divide-y divide-line">
      {shelves.map((sh) => (
        <div key={sh.id} className="flex items-center gap-2 px-3 py-2">
          <span className="tnum w-8 shrink-0 font-display text-[18px]">{sh.shelf_number}</span>
          <input className="field flex-1" placeholder="Nom (facultatif)" defaultValue={sh.label ?? ''}
            onBlur={(e) => e.target.value !== (sh.label ?? '') && act((a) => a.saveShelf({ id: sh.id, shelf_number: sh.shelf_number, label: e.target.value || null }))} />
          <input className="field tnum w-20" inputMode="numeric" placeholder="Cap." defaultValue={sh.capacity ?? ''} aria-label="Capacité"
            onBlur={(e) => String(sh.capacity ?? '') !== e.target.value && act((a) => a.saveShelf({ id: sh.id, shelf_number: sh.shelf_number, capacity: e.target.value ? Number(e.target.value) : null }))} />
          <button aria-label={`Supprimer la clayette ${sh.shelf_number}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-danger"
            onClick={() => confirm(`Supprimer la clayette ${sh.shelf_number} ? Ses bouteilles resteront en cave, sans clayette.`) && act((a) => a.deleteShelf(sh.id), 'Clayette supprimée')}>
            <Trash2 size={18} strokeWidth={1.75} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="tnum w-8 shrink-0 font-display text-[18px] text-muted">{next}</span>
        <input className="field tnum flex-1" inputMode="numeric" placeholder="Capacité (bouteilles)" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} />
        <Button className="!px-4" onClick={async () => { await act((a) => a.saveShelf({ shelf_number: next, capacity: cap ? Number(cap) : null }), `Clayette ${next} ajoutée`); setCap('') }}><Plus {...ICON} />Ajouter</Button>
      </div>
    </Card>
  )
}
