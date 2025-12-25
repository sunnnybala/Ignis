import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.log('[debug] supabase.init', { hasUrl: !!url, hasAnonKey: !!anonKey })
}

if (!url || !anonKey) {
  // Fail fast-ish: the app can still render, but auth calls will fail.
  // eslint-disable-next-line no-console
  console.warn(
    '[warn] supabase.misconfigured: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Persist session in local storage so refresh keeps you logged in
    persistSession: true,
    autoRefreshToken: true,
    // Required for OAuth redirect flows
    detectSessionInUrl: true,
  },
})


