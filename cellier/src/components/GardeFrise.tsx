import type { Wine } from '../lib/types'

/** Frise de garde : avant, apogée, déclin, avec l'année en cours repérée. */
export function GardeFrise({ wine }: { wine: Pick<Wine, 'drink_from' | 'drink_peak' | 'drink_until' | 'vintage'> }) {
  const { drink_from: from, drink_until: until } = wine
  if (from == null || until == null) return <p className="text-[15px] text-muted">Fenêtre de garde pas encore estimée.</p>
  const year = new Date().getFullYear()
  const peak = wine.drink_peak ?? Math.round(from + (until - from) * 0.55)
  const start = Math.min(wine.vintage ?? from - 3, from - 1, year)
  const end = Math.max(until + 2, year + 1)
  const span = end - start
  const x = (y: number) => `${((y - start) / span) * 100}%`
  const peakFrom = Math.max(from, peak - 1)
  const peakTo = Math.min(until, peak + 1)
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 bg-ok/35" style={{ left: x(from), width: `calc(${x(peakFrom)} - ${x(from)})` }} />
        <div className="absolute inset-y-0 bg-ok" style={{ left: x(peakFrom), width: `calc(${x(peakTo + 1)} - ${x(peakFrom)})` }} />
        <div className="absolute inset-y-0 bg-warn/45" style={{ left: x(peakTo + 1), width: `calc(${x(until + 1)} - ${x(peakTo + 1)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `calc(${x(year)} + ${100 / span / 2}%)` }} aria-label={`Année ${year}`} />
      </div>
      <div className="relative mt-1 h-5 text-[13px] text-muted tnum">
        <span className="absolute -translate-x-1/2" style={{ left: x(from) }}>{from}</span>
        <span className="absolute -translate-x-1/2 font-semibold text-text" style={{ left: `calc(${x(year)} + ${100 / span / 2}%)` }}>{year}</span>
        <span className="absolute -translate-x-1/2" style={{ left: x(until + 1) }}>{until}</span>
      </div>
      <div className="mt-1 flex gap-3 text-[13px] text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-ok/40" />Avant</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Apogée {peakFrom === peakTo ? peakFrom : `${peakFrom}–${peakTo}`}</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warn/50" />Déclin</span>
      </div>
    </div>
  )
}
