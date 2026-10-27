import { Camera, Home, MoreHorizontal, Search, Wine } from 'lucide-react'
import { useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { setPendingPhotos } from '../lib/pendingPhotos'
import { ICON } from './ui'

const tabs = [
  { to: '/', label: 'Accueil', icon: Home },
  { to: '/cave', label: 'Cave', icon: Wine },
  { to: '/ajouter', label: 'Ajouter', icon: Camera, center: true },
  { to: '/chasse', label: 'Chasse', icon: Search },
  { to: '/plus', label: 'Plus', icon: MoreHorizontal },
]

export function TabBar() {
  const input = useRef<HTMLInputElement>(null)
  const nav = useNavigate()
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line backdrop-blur-xl"
      style={{ background: 'var(--tabbar)' }}
      aria-label="Navigation principale"
    >
      <div className="mx-auto flex max-w-xl">
        {tabs.map(({ to, label, icon: Icon, center }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={(e) => {
              // L'appareil photo s'ouvre directement : le clic doit rester dans le geste de l'utilisateur.
              if (center && !location.pathname.startsWith('/ajouter')) {
                e.preventDefault()
                input.current?.click()
              }
            }}
            className={({ isActive }) => `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[12px] ${isActive ? 'text-primary' : 'text-muted'}`}
          >
            {center ? (
              <span className="-mt-1 flex h-10 w-14 items-center justify-center rounded-full bg-primary text-on-primary">
                <Icon size={22} strokeWidth={1.75} />
              </span>
            ) : (
              <Icon {...ICON} size={22} />
            )}
            <span className="font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (!files.length) return
          setPendingPhotos(files)
          nav('/ajouter')
        }}
      />
    </nav>
  )
}
