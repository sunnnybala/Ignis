import * as React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, CheckCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/sonner"

const FORMSPREE_ID = import.meta.env.VITE_FORMSPREE_ID as string | undefined

export interface WaitlistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ROLE_OPTIONS = [
  "Academic Researcher",
  "Industrial Researcher",
  "Student",
  "Other",
] as const

function isValidEmail(email: string) {
  // basic sanity check; avoids adding extra deps just for validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default function WaitlistDialog({ open, onOpenChange }: WaitlistDialogProps) {
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<(typeof ROLE_OPTIONS)[number] | "">("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isSuccess, setIsSuccess] = React.useState(false)

  // Only disable while actively submitting; otherwise keep the CTA visually enabled.
  // If FORMSPREE_ID is missing, we handle it with a toast message on submit.
  const canSubmit = !isSubmitting

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!FORMSPREE_ID) {
      toast.error("Configuration required", {
        description: "Set VITE_FORMSPREE_ID in your frontend environment.",
      })
      return
    }

    if (!isValidEmail(email)) {
      toast.error("Please enter a valid email address.")
      return
    }

    if (!role) {
      toast.error("Please select your role.")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, role }),
      })

      if (!response.ok) throw new Error("Failed to submit")

      setIsSuccess(true)
      setEmail("")
      setRole("")

      window.setTimeout(() => {
        setIsSuccess(false)
        onOpenChange(false)
      }, 1400)
    } catch {
      toast.error("Failed to join waitlist.", { description: "Please try again." })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        {/* Note: this dialog is portaled to <body>, so it won't inherit `.landing-theme` variables.
            Apply the landing theme class directly to ensure correct colors/gradients. */}
        <Dialog.Content className="landing-theme fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 text-foreground shadow-xl outline-none">
          {isSuccess ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle className="mb-4 h-16 w-16 text-accent" />
              <Dialog.Title className="mb-2 text-2xl font-semibold">
                You&apos;re on the list!
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground">
                We&apos;ll notify you when Ignis launches.
              </Dialog.Description>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Dialog.Title className="text-2xl font-semibold">
                  Join the Waitlist
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  Be the first to experience AI-powered research automation. We&apos;ll notify you when Ignis launches.
                </Dialog.Description>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    inputMode="email"
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <select
                    className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                  >
                    <option value="" disabled>
                      Select your role
                    </option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r} className="bg-background text-foreground">
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!canSubmit}
                  variant="hero"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Joining…
                    </>
                  ) : (
                    "Join Waitlist"
                  )}
                </Button>

                {!FORMSPREE_ID ? (
                  <div className="text-sm text-muted-foreground">
                    Set <span className="font-mono">VITE_FORMSPREE_ID</span> in your frontend environment to enable submissions.
                  </div>
                ) : null}
              </form>
            </>
          )}

          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}


