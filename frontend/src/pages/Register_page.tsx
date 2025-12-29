import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/auth/AuthProvider"
import { supabase } from "@/lib/supabaseClient"

function debug(event: string, fields?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console
  console.log("[debug] auth.register", event, fields || {})
}

function warn(event: string, fields?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.warn("[warn] auth.register", event, fields || {})
}

function classifyError(err: unknown): { category: string; message: string } {
  const msg = String((err as any)?.message || err || "")
  if (/already registered/i.test(msg) || /user already registered/i.test(msg)) {
    return { category: "user_exists", message: "This email is already registered. Please log in." }
  }
  if (/password/i.test(msg) && /weak|short|min/i.test(msg)) {
    return { category: "weak_password", message: "Password is too weak. Please choose a stronger one." }
  }
  if (/email not confirmed/i.test(msg)) {
    return { category: "email_not_confirmed", message: "Email confirmation is required (disabled for MVP)." }
  }
  if (/network/i.test(msg) || /fetch/i.test(msg)) {
    return { category: "network_error", message: "Network error. Please try again." }
  }
  return { category: "unknown", message: "Registration failed. Please try again." }
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading, signUp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = useMemo(() => {
    const raw = searchParams.get("from")
    if (!raw) return "/home/projects"
    return raw.startsWith("/") ? raw : "/home/projects"
  }, [searchParams])

  useEffect(() => {
    if (loading) return
    if (user) navigate(from, { replace: true })
  }, [from, loading, navigate, user])

  const register = async () => {
    setError(null)
    const e = email.trim()
    if (!e || !password) return

    debug("submit", { action: "register", method: "password", email: e })
    setSubmitting(true)
    try {
      await signUp(e, password)
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user?.id ?? null
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[info] auth.register success", { method: "password", userId })
      }
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const c = classifyError(err)
      warn("failure", { category: c.category })
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[debug] auth.register error.detail", {
          category: c.category,
          message: String((err as any)?.message || err),
        })
      }
      setError(c.message)
    } finally {
      setSubmitting(false)
    }
  }

  const registerGoogle = async () => {
    setError(null)
    debug("submit", { action: "register", method: "google" })
    setSubmitting(true)
    try {
      await signInWithGoogle(from)
    } catch (err: unknown) {
      const c = classifyError(err)
      warn("failure", { category: c.category })
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[debug] auth.register error.detail", {
          category: c.category,
          message: String((err as any)?.message || err),
        })
      }
      setError(c.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Enter your email below to register your account</CardDescription>
          <CardAction>
            <Button variant="link" type="button" onClick={() => navigate("/", { replace: false })}>
              Back
            </Button>
          </CardAction>
        </CardHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void register()
          }}
        >
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              {error ? <div className="text-sm text-destructive">{error}</div> : null}
            </div>
          </CardContent>

          <CardFooter className="flex-col gap-2 pt-4">
            <Button type="submit" className="w-full">
              {submitting ? "Creating account…" : "Register"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void registerGoogle()}
              disabled={submitting}
            >
              Continue with Google
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}


