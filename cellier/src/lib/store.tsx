import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Api } from './api'
import { supabaseApi } from './api'
import { buildRows, type CellarRow } from './cellar'
import { demoApi } from './demo'
import { DEMO } from './supabase'
import type { CellarData } from './types'

const CACHE = 'cellier.cache.v1'

interface Store {
  api: Api
  data: CellarData | null
  rows: CellarRow[]
  online: boolean
  fromCache: boolean
  error: string | null
  refresh: () => Promise<void>
  /** Exécute une action, affiche l'erreur éventuelle, puis recharge. */
  act: <T>(f: (api: Api) => Promise<T>, message?: string) => Promise<T | undefined>
  toast: string | null
  setToast: (t: string | null) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => (DEMO ? demoApi() : supabaseApi()), [])
  const [data, setData] = useState<CellarData | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE) ?? 'null')
    } catch {
      return null
    }
  })
  const [fromCache, setFromCache] = useState(!!data)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const housekept = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const d = await api.loadAll()
      setData(d)
      setFromCache(false)
      setError(null)
      try {
        // Copie locale : consultation de la cave et « Quoi ouvrir ce soir » hors ligne.
        localStorage.setItem(CACHE, JSON.stringify(d))
      } catch { /* stockage plein : on garde seulement la mémoire */ }
      if (!housekept.current) {
        housekept.current = true
        api.housekeeping().catch(() => {})
      }
    } catch (e) {
      setFromCache(true)
      setError(navigator.onLine ? (e as Error).message : null)
    }
  }, [api])

  useEffect(() => {
    refresh()
    const on = () => { setOnline(true); refresh() }
    const off = () => setOnline(false)
    const vis = () => document.visibilityState === 'visible' && refresh()
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const theme = data?.settings.theme
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    try { localStorage.setItem('cellier.theme', theme) } catch { /* rien */ }
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#161A17' : '#F4F1EA'))
  }, [theme])

  const act = useCallback(
    async <T,>(f: (api: Api) => Promise<T>, message?: string) => {
      if (!navigator.onLine && !DEMO) {
        setToast('Hors ligne : cette action demande du réseau')
        return undefined
      }
      try {
        const r = await f(api)
        if (message) setToast(message)
        await refresh()
        return r
      } catch (e) {
        setToast((e as Error).message)
        return undefined
      }
    },
    [api, refresh],
  )

  const rows = useMemo(() => (data ? buildRows(data) : []), [data])

  return (
    <Ctx.Provider value={{ api, data, rows, online, fromCache, error, refresh, act, toast, setToast }}>
      {children}
    </Ctx.Provider>
  )
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider manquant')
  return s
}

export const clearCache = () => localStorage.removeItem(CACHE)
