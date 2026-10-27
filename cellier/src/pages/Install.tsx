import { PlusSquare, Share } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '../components/ui'

const SEEN = 'cellier.installSeen'
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

/** Page d'aide affichée au premier lancement dans Safari sur iPhone. */
export const shouldShowInstall = () => {
  try {
    return isIos() && !standalone() && !localStorage.getItem(SEEN)
  } catch {
    return false
  }
}

export default function Install() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const done = () => {
    try { localStorage.setItem(SEEN, '1') } catch { /* rien */ }
    nav(params.get('aide') ? -1 as never : '/', { replace: !params.get('aide') })
  }
  return (
    <>
      <PageHeader title="Installer Cellier" back={!!params.get('aide')} />
      <div className="px-safe">
        {standalone() ? (
          <Card className="p-4 text-[15px]">Cellier est déjà installé sur cet appareil.</Card>
        ) : (
          <ol className="space-y-3">
            <Card className="flex items-center gap-3 p-4"><span className="font-display text-[22px] text-accent">1</span>
              <span className="flex-1 text-[15px]">Dans Safari, touche le bouton <b>Partager</b> <Share size={18} className="inline text-primary" /> en bas de l’écran.</span></Card>
            <Card className="flex items-center gap-3 p-4"><span className="font-display text-[22px] text-accent">2</span>
              <span className="flex-1 text-[15px]">Fais défiler et choisis <b>Sur l’écran d’accueil</b> <PlusSquare size={18} className="inline text-primary" />.</span></Card>
            <Card className="flex items-center gap-3 p-4"><span className="font-display text-[22px] text-accent">3</span>
              <span className="flex-1 text-[15px]">Ouvre Cellier depuis son icône : il s’affiche en plein écran, et la cave reste consultable hors ligne.</span></Card>
          </ol>
        )}
        <p className="mt-4 text-[14px] text-muted">L’app installée a sa propre session : connecte-toi une fois dedans avec le code reçu par mail.</p>
        <Button className="mt-5 w-full" onClick={done}>{params.get('aide') ? 'Retour' : 'Continuer dans Safari'}</Button>
      </div>
    </>
  )
}
