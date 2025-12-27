import { supabase } from '@/lib/supabaseClient'

async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return null
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * Returns Authorization header for the current Supabase session, if present.
 * Used by both JSON APIs and SSE endpoints so backend `req.user` is populated.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}


