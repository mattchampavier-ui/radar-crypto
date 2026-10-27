import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const DEMO = import.meta.env.VITE_DEMO === '1' || !url || !key
export const supabase = DEMO ? null : createClient(url!, key!, { auth: { persistSession: true, detectSessionInUrl: true } })
