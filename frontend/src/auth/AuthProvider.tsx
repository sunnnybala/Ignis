import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabaseClient'

type AuthContextValue = {
  loading: boolean
  session: Session | null
  user: User | null
  accessToken: string | null
  signUp: (email: string, password: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInWithGoogle: (next?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function debug(...args: any[]) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[debug] auth', ...args)
  }
}

function info(...args: any[]) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[info] auth', ...args)
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  const user = session?.user ?? null
  const accessToken = session?.access_token ?? null

  useEffect(() => {
    let mounted = true

    debug('init.start')
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          info('init.error', { message: error.message })
          setSession(null)
          setLoading(false)
          return
        }
        setSession(data.session ?? null)
        setLoading(false)
        debug('init.end', { userId: data.session?.user?.id ?? null })
      })
      .catch((err: unknown) => {
        if (!mounted) return
        info('init.error', { message: String((err as any)?.message || err) })
        setSession(null)
        setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Logging point: auth state change (info)
      info('state.change', { event, userId: nextSession?.user?.id ?? null })
      if (!mounted) return
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string) => {
    info('action.signup', { method: 'password' })
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
  }

  const signInWithPassword = async (email: string, password: string) => {
    info('action.login', { method: 'password' })
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const signInWithGoogle = async (next?: string) => {
    info('action.login', { method: 'google' })
    const rawBase = (import.meta.env.VITE_AUTH_REDIRECT_URL as string) || window.location.origin
    const base = String(rawBase || '').replace(/\/+$/, '') || window.location.origin

    // Always route OAuth back to our callback handler, not to "/".
    // `next` must be an in-app path; the callback page re-validates this too.
    const safeNext = typeof next === 'string' && next.startsWith('/') ? next : '/home/projects'
    const callbackBase = base.endsWith('/auth/callback') ? base : `${base}/auth/callback`
    const redirectTo = `${callbackBase}?next=${encodeURIComponent(safeNext)}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw error
  }

  const signOut = async () => {
    info('action.logout', { method: 'supabase' })
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user,
      accessToken,
      signUp,
      signInWithPassword,
      signInWithGoogle,
      signOut,
    }),
    [accessToken, loading, session, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}


