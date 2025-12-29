import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { supabase } from '@/lib/supabaseClient'

function safeNext(raw: string | null): string {
  const fallback = '/home/projects'
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  // Avoid redirecting back into auth pages.
  if (raw.startsWith('/login') || raw.startsWith('/register') || raw.startsWith('/auth')) return fallback
  return raw
}

/**
 * OAuth callback landing page.
 *
 * Supabase JS (with detectSessionInUrl: true) will typically finalize the session automatically
 * on redirect. This page simply waits briefly for the session to appear, then forwards the user
 * to /home/projects (or a safe in-app `next`).
 */
export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const next = useMemo(() => safeNext(searchParams.get('next')), [searchParams])
  const [status, setStatus] = useState<'working' | 'failed'>('working')

  useEffect(() => {
    let cancelled = false

    async function run() {
      // Give Supabase a moment to process the redirect URL and persist the session.
      const startedAt = Date.now()
      const timeoutMs = 6_000

      while (!cancelled && Date.now() - startedAt < timeoutMs) {
        const { data, error } = await supabase.auth.getSession()
        if (error) break
        if (data.session?.user) {
          navigate(next, { replace: true })
          return
        }
        await new Promise((r) => setTimeout(r, 150))
      }

      if (!cancelled) setStatus('failed')
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, next])

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="text-lg font-semibold">Signing you in…</div>
        <div className="mt-2 text-sm text-muted-foreground">
          {status === 'working'
            ? 'Please wait while we finish authentication.'
            : 'We could not finish authentication. Please try again.'}
        </div>
      </div>
    </div>
  )
}


