import type { PropsWithChildren } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'

/**
 * Route guard:
 * - while auth is booting -> render nothing (or you can swap in a spinner later)
 * - if unauthenticated -> redirect to /login and preserve "from"
 * - else -> render children
 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { loading, user } = useAuth()
  const location = useLocation()

  if (loading) return null

  if (!user) {
    const from = location.pathname + location.search
    return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />
  }

  return <>{children}</>
}


