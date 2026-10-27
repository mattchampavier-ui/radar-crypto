import { ChevronLeft, X } from 'lucide-react'
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { VERDICTS } from '../lib/constants'
import { GARDE_LABEL, type GardeStatus } from '../lib/cellar'
import { useStore } from '../lib/store'
import type { Verdict, WineColor } from '../lib/types'

export const ICON = { size: 20, strokeWidth: 1.75 } as const

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({ variant = 'primary', className = '', children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-primary text-on-primary',
    secondary: 'bg-surface-2 text-text',
    ghost: 'text-primary',
    danger: 'bg-danger text-white',
  }
  return (
    <button
      {...p}
      className={`anim inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium active:opacity-80 disabled:opacity-40 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-card bg-surface shadow-card ${onClick ? 'cursor-pointer active:opacity-90' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function WineDot({ color, size = 10 }: { color: WineColor | null | undefined; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color ? `var(--wine-${color})` : 'transparent',
        border: color ? 'none' : '1.5px dashed var(--text-muted)',
        boxShadow: color === 'blanc' || color === 'effervescent' ? 'inset 0 0 0 1px rgb(0 0 0 / .12)' : undefined,
      }}
    />
  )
}

export function Pill({ children, tone = 'muted', className = '' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' | 'primary'; className?: string }) {
  const t = {
    ok: 'bg-ok text-white',
    warn: 'bg-warn text-white',
    danger: 'bg-danger text-white',
    muted: 'bg-surface-2 text-muted',
    accent: 'bg-accent text-white',
    primary: 'bg-primary-soft text-primary',
  }[tone]
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium ${t} ${className}`}>{children}</span>
}

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Pill>En analyse</Pill>
  const tone = verdict === 'a_viser' ? 'ok' : verdict === 'a_surveiller' ? 'warn' : 'muted'
  return <Pill tone={tone}>{VERDICTS[verdict]}</Pill>
}

export function GardeBadge({ status }: { status: GardeStatus }) {
  const tone = status === 'passe' ? 'danger' : status === 'fin' ? 'warn' : status === 'a_boire' || status === 'apogee' ? 'ok' : 'muted'
  return <Pill tone={tone as 'ok'}>{GARDE_LABEL[status]}</Pill>
}

export function VintageBadge({ vintage }: { vintage: number | null }) {
  return (
    <span className="tnum inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-[13px] font-semibold text-accent">{vintage ?? 'NM'}</span>
  )
}

export function PageHeader({ title, back, right, subtitle }: { title: string; back?: boolean; right?: ReactNode; subtitle?: ReactNode }) {
  const nav = useNavigate()
  return (
    <header className="pt-safe px-safe sticky top-0 z-20 bg-bg/90 pb-2 backdrop-blur-md">
      <div className="flex min-h-11 items-center gap-2">
        {back && (
          <button aria-label="Retour" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))} className="-ml-2 flex h-11 w-11 items-center justify-center text-primary">
            <ChevronLeft size={26} strokeWidth={1.75} />
          </button>
        )}
        <h1 className="flex-1 truncate text-[26px] leading-tight">{title}</h1>
        {right}
      </div>
      {subtitle && <div className="text-[14px] text-muted">{subtitle}</div>}
    </header>
  )
}

export function Section({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-6 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[19px]">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[15px] text-muted">{children}</div>
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', k)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal aria-label={title}>
      <div className="fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="sheet-in pb-safe relative max-h-[92dvh] overflow-y-auto rounded-t-[20px] bg-surface">
        <div className="sticky top-0 z-10 bg-surface px-4 pt-2">
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-line" />
          <div className="flex min-h-11 items-center justify-between">
            <h2 className="text-[20px]">{title}</h2>
            <button aria-label="Fermer" onClick={onClose} className="-mr-2 flex h-11 w-11 items-center justify-center text-muted">
              <X {...ICON} />
            </button>
          </div>
        </div>
        <div className="px-4 pb-6">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint, warn }: { label: string; children: ReactNode; hint?: ReactNode; warn?: boolean }) {
  return (
    <label className="mb-3 block">
      <span className={`mb-1 flex items-center gap-1 text-[14px] font-medium ${warn ? 'text-warn' : 'text-muted'}`}>
        {label}
        {warn && <span className="text-[13px]">· à vérifier</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, wrap }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; wrap?: boolean }) {
  return (
    <div className={`flex gap-1.5 ${wrap ? 'flex-wrap' : 'overflow-x-auto'} [-ms-overflow-style:none] [scrollbar-width:none]`}>
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`anim min-h-11 shrink-0 rounded-full px-4 text-[15px] ${value === o.id ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="inline-flex items-center rounded-full bg-surface-2">
      <button type="button" aria-label="Moins" className="h-11 w-12 text-[22px] text-primary disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="tnum w-8 text-center text-[17px] font-semibold">{value}</span>
      <button type="button" aria-label="Plus" className="h-11 w-12 text-[22px] text-primary disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex-1 rounded-card bg-surface p-3 shadow-card">
      <div className="tnum font-display text-[24px] leading-tight">{value}</div>
      <div className="text-[13px] leading-tight text-muted">{label}</div>
    </div>
  )
}

// Liens signés des photos : gardés une semaine dans le navigateur pour l'affichage hors ligne.
const URLS_KEY = 'cellier.photoUrls.v1'
let urlCache: Record<string, { url: string; exp: number }> = (() => {
  try {
    return JSON.parse(localStorage.getItem(URLS_KEY) ?? '{}')
  } catch {
    return {}
  }
})()

export function usePhotoUrl(path: string | null | undefined) {
  const { api } = useStore()
  const cached = path ? urlCache[path] : undefined
  const [url, setUrl] = useState<string | null>(path?.startsWith('data:') ? path : cached?.url ?? null)
  useEffect(() => {
    if (!path) return setUrl(null)
    if (path.startsWith('data:') || path.startsWith('http')) return setUrl(path)
    const c = urlCache[path]
    if (c && (c.exp > Date.now() || !navigator.onLine)) return setUrl(c.url)
    let alive = true
    api.photoUrl(path).then((u) => {
      if (!alive || !u) return
      urlCache = { ...urlCache, [path]: { url: u, exp: Date.now() + 50 * 60e3 } }
      try { localStorage.setItem(URLS_KEY, JSON.stringify(urlCache)) } catch { /* rien */ }
      setUrl(u)
    })
    return () => { alive = false }
  }, [path, api])
  return url
}

export function Thumb({ path, color, className = 'w-12' }: { path: string | null | undefined; color?: WineColor | null; className?: string }) {
  const url = usePhotoUrl(path)
  return (
    <div className={`relative aspect-[3/4] shrink-0 overflow-hidden rounded-thumb bg-surface-2 ${className}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-end justify-center pb-2">
          <svg viewBox="0 0 24 60" className="h-3/4 opacity-80" aria-hidden>
            <path d="M9 2h6v14c0 3 4 5 4 10v30a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V26c0-5 4-7 4-10z" fill={color ? `var(--wine-${color})` : 'var(--line)'} />
          </svg>
        </div>
      )}
    </div>
  )
}

export function Toast() {
  const { toast } = useStore()
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
      <div className="fade-in rounded-full bg-text px-4 py-2.5 text-[15px] text-bg shadow-lg">{toast}</div>
    </div>
  )
}
