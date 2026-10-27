import { Clock, LogOut } from 'lucide-react'
import { useRef, useState, type TouchEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { wineSubtitle, wineTitle, type CellarRow } from '../lib/cellar'
import { GardeBadge, Pill, Thumb, VintageBadge, WineDot } from './ui'

/** Carte vin (section 8.3). Glisser vers la gauche révèle « Sortir une bouteille ». */
export function WineCard({ row, onTake, highlight }: { row: CellarRow; onTake?: (row: CellarRow) => void; highlight?: boolean }) {
  const nav = useNavigate()
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number; dx: number; horiz: boolean | null } | null>(null)
  const ACTION = 112
  const w = row.wine

  const onStart = (e: TouchEvent) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx, horiz: null }
  }
  const onMove = (e: TouchEvent) => {
    const s = start.current
    if (!s || !onTake) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (s.horiz === null && Math.abs(mx) + Math.abs(my) > 8) s.horiz = Math.abs(mx) > Math.abs(my)
    if (s.horiz) setDx(Math.max(-ACTION - 20, Math.min(0, s.dx + mx)))
  }
  const onEnd = () => {
    if (start.current?.horiz) setDx(dx < -ACTION / 2 ? -ACTION : 0)
    start.current = null
  }

  return (
    <div className={`relative overflow-hidden rounded-card ${highlight ? 'ring-2 ring-primary' : ''}`}>
      {onTake && (
        <button
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-primary px-3 text-[13px] font-medium text-on-primary"
          style={{ width: ACTION }}
          onClick={() => { setDx(0); onTake(row) }}
          tabIndex={dx ? 0 : -1}
        >
          <LogOut size={20} strokeWidth={1.75} />
          Sortir une bouteille
        </button>
      )}
      <div
        className="relative flex cursor-pointer items-center gap-3 bg-surface p-2.5 shadow-card"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 180ms ease' }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onClick={() => (dx ? setDx(0) : nav(`/vin/${w.id}`))}
      >
        <Thumb path={row.thumb} color={w.color} className="w-12" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <WineDot color={w.color} />
            <span className="truncate font-display text-[17px] font-semibold leading-snug">{wineTitle(w)}</span>
          </div>
          <div className="truncate text-[14px] text-muted">{wineSubtitle(w) || (row.pending ? 'Fiche remplie au prochain passage' : ' ')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <VintageBadge vintage={w.vintage} />
            {row.pending ? (
              <Pill tone="accent"><Clock size={12} strokeWidth={2} />En attente</Pill>
            ) : w.status === 'a_verifier' ? (
              <Pill tone="warn">À vérifier</Pill>
            ) : (
              <GardeBadge status={row.garde} />
            )}
            {row.shelves.length > 0 && <span className="text-[13px] text-muted">Clayette {row.shelves.map((s) => s.shelf_number).join(', ')}</span>}
          </div>
        </div>
        <div className="tnum pr-1 text-right">
          <div className="font-display text-[22px] leading-none">{row.quantity}</div>
          <div className="text-[12px] text-muted">btl</div>
        </div>
      </div>
    </div>
  )
}
