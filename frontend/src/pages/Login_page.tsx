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
  console.log("[debug] auth.login", event, fields || {})
}

function warn(event: string, fields?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.warn("[warn] auth.login", event, fields || {})
}

function classifyError(err: unknown): { category: string; message: string } {
  const msg = String((err as any)?.message || err || "")

  // Supabase commonly returns these patterns.
  if (/invalid login credentials/i.test(msg)) {
    return { category: "invalid_credentials", message: "Invalid email or password." }
  }
  if (/email not confirmed/i.test(msg)) {
    return {
      category: "email_not_confirmed",
      message: "Email not confirmed. (We can enable/disable this later in Supabase.)",
    }
  }
  if (/rate limit/i.test(msg) || /too many/i.test(msg)) {
    return { category: "rate_limited", message: "Too many attempts. Please try again later." }
  }
  if (/network/i.test(msg) || /fetch/i.test(msg)) {
    return { category: "network_error", message: "Network error. Please try again." }
  }
  return { category: "unknown", message: "Login failed. Please try again." }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading, signInWithPassword, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = useMemo(() => {
    const raw = searchParams.get("from")
    if (!raw) return "/home/projects"
    // Prevent open redirects. Only allow in-app paths.
    return raw.startsWith("/") ? raw : "/home/projects"
  }, [searchParams])

  // If already logged in, bounce to target.
  useEffect(() => {
    if (loading) return
    if (user) {
      navigate(from, { replace: true })
    }
  }, [from, loading, navigate, user])

  const signIn = async () => {
    setError(null)
    const e = email.trim()
    if (!e || !password) return

    debug("submit", { action: "login", method: "password", email: e })
    setSubmitting(true)
    try {
      await signInWithPassword(e, password)
      // Best-effort log userId after successful login
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user?.id ?? null
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[info] auth.login success", { method: "password", userId })
      }
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const c = classifyError(err)
      // Avoid leaking provider error details in production logs
      warn("failure", { category: c.category })
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[debug] auth.login error.detail", {
          category: c.category,
          message: String((err as any)?.message || err),
        })
      }
      setError(c.message)
    } finally {
      setSubmitting(false)
    }
  }

  const signInGoogle = async () => {
    setError(null)
    debug("submit", { action: "login", method: "google" })
    setSubmitting(true)
    try {
      // This triggers a redirect; it typically won't return in the same page.
      await signInWithGoogle(from)
    } catch (err: unknown) {
      const c = classifyError(err)
      warn("failure", { category: c.category })
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[debug] auth.login error.detail", {
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
          <CardTitle>Login to your account</CardTitle>
          <CardDescription>Enter your email below to login to your account</CardDescription>
          <CardAction>
            <Button variant="link" type="button" onClick={() => navigate("/", { replace: false })}>
              Back
            </Button>
          </CardAction>
        </CardHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void signIn()
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
                  <button
                    type="button"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                    onClick={() => {
                      setError("Password reset isn't implemented yet.")
                    }}
                    disabled={submitting}
                  >
                    Forgot your password?
                  </button>
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
              {submitting ? "Logging in…" : "Login"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void signInGoogle()}
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
