import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { TabBar } from './components/TabBar'
import { Toast } from './components/ui'
import { StoreProvider, useStore } from './lib/store'
import { DEMO, supabase } from './lib/supabase'
import Add from './pages/Add'
import AiQueue from './pages/AiQueue'
import Cave from './pages/Cave'
import Home from './pages/Home'
import Hunt from './pages/Hunt'
import HuntLotPage from './pages/HuntLot'
import Install, { shouldShowInstall } from './pages/Install'
import Journal from './pages/Journal'
import Login from './pages/Login'
import More from './pages/More'
import SettingsPage from './pages/Settings'
import Tonight from './pages/Tonight'
import Value from './pages/Value'
import WineDetail from './pages/WineDetail'

function Shell() {
  const { data, fromCache, online, error } = useStore()
  const loc = useLocation()
  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-[32px]">Cellier</h1>
        <p className="text-muted">{error ?? 'Ouverture de la cave…'}</p>
      </div>
    )
  }
  if (shouldShowInstall() && loc.pathname !== '/installer') return <Navigate to="/installer" replace />
  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      {(!online || (fromCache && error)) && (
        <div className="pt-safe bg-warn px-4 pb-1.5 text-center text-[13px] font-medium text-white">
          {!online ? 'Hors ligne — consultation seule' : `Données locales — ${error}`}
        </div>
      )}
      {DEMO && loc.pathname === '/' && (
        <div className="pt-safe bg-accent px-4 pb-1.5 text-center text-[13px] font-medium text-white">Mode démo — données fictives</div>
      )}
      <main className="pb-tabbar">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cave" element={<Cave />} />
          <Route path="/ajouter" element={<Add />} />
          <Route path="/vin/:id" element={<WineDetail />} />
          <Route path="/ce-soir" element={<Tonight />} />
          <Route path="/chasse" element={<Hunt />} />
          <Route path="/chasse/:id" element={<HuntLotPage />} />
          <Route path="/plus" element={<More />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/valeur" element={<Value />} />
          <Route path="/reglages" element={<SettingsPage />} />
          <Route path="/file-ia" element={<AiQueue />} />
          <Route path="/installer" element={<Install />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
      <Toast />
    </div>
  )
}

function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(DEMO ? null : undefined)
  useEffect(() => {
    if (DEMO || !supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (DEMO) return <>{children}</>
  if (session === undefined) return null
  // Hors ligne avec une copie locale : on laisse consulter même si la session n'a pas pu être rafraîchie.
  if (!session && !(navigator.onLine === false && localStorage.getItem('cellier.cache.v1'))) return <Login />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <StoreProvider>
          <Shell />
        </StoreProvider>
      </AuthGate>
    </BrowserRouter>
  )
}
