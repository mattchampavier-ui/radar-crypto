import { useState } from 'react'
import { Button } from '../components/ui'
import { supabase } from '../lib/supabase'

/**
 * Connexion par lien magique. Sur iPhone, l'app installée ne partage pas sa session avec Safari :
 * le mail contient aussi un code à 6 chiffres (modèle de mail Supabase avec {{ .Token }}) à saisir ici.
 */
export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } })
    setBusy(false)
    if (error) setErr(error.message)
    else setSent(true)
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const { error } = await supabase!.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setErr('Code refusé ou expiré')
  }

  return (
    <div className="pt-safe px-safe flex min-h-dvh flex-col justify-center">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 text-[40px]">Cellier</h1>
        <p className="mb-8 text-muted">Ta cave, et les bonnes affaires à portée de main.</p>
        {sent ? (
          <form onSubmit={verify}>
            <p className="mb-3 text-[15px]">
              Mail envoyé à <b>{email}</b>. Touche le lien, ou saisis ici le code reçu (pratique depuis l’app installée).
            </p>
            <input className="field tnum mb-3 text-center text-[22px] tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code"
              maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••" />
            <Button className="w-full" type="submit" disabled={busy || code.trim().length < 6}>Valider le code</Button>
            <Button variant="ghost" className="mt-2 w-full" type="button" onClick={() => setSent(false)}>Changer d’adresse</Button>
          </form>
        ) : (
          <form onSubmit={send}>
            <label className="mb-1 block text-[14px] font-medium text-muted" htmlFor="email">Adresse mail</label>
            <input id="email" className="field mb-3" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="w-full" type="submit" disabled={busy}>Recevoir un lien de connexion</Button>
          </form>
        )}
        {err && <p className="mt-3 text-[15px] text-danger">{err}</p>}
      </div>
    </div>
  )
}
