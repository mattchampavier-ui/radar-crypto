const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const eur = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : eur0.format(n))
export const eurRange = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo == null ? '—' : hi == null || Math.round(hi) === Math.round(lo) ? eur(lo) : `${eur(lo).replace(/\s?€/, '')}–${eur(hi)}`

const dFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const dShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
export const date = (s: string | null | undefined) => (s ? dFmt.format(new Date(s)) : '—')
export const dateShort = (s: string | null | undefined) => (s ? dShort.format(new Date(s)) : '—')

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)} %`)

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`

export const daysUntil = (s: string, now = new Date()) => {
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''))
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - t.getTime()) / 864e5)
}
