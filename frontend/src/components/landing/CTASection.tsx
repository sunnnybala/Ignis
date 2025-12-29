import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Rocket } from "lucide-react"

import { Button } from "@/components/ui/button"
import WaitlistDialog from "@/components/landing/WaitlistDialog"

export default function CTASection() {
  const [showWaitlist, setShowWaitlist] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (window.location.hash === "#waitlist") {
      setShowWaitlist(true)
    }
  }, [])

  return (
    <section id="waitlist" className="relative overflow-hidden px-4 py-24">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background" />
      <div className="absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="container mx-auto relative z-10 max-w-4xl">
        <div className="text-center animate-fade-in">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card px-4 py-2">
            <Rocket className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              Ready to Transform Your Research?
            </span>
          </div>

          <h2 className="mb-6 text-4xl font-bold md:text-6xl">
            Start Publishing Faster Today
          </h2>

          <p className="mx-auto mb-10 max-w-2xl text-xl text-muted-foreground">
            Join the researchers who are accelerating their work with AI-powered
            automation. From idea to publication in minutes, not months.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              size="lg"
              variant="hero"
              className="group h-auto px-8 py-6 text-lg"
              onClick={() => navigate("/register?from=%2Fhome%2Fprojects")}
            >
              Get Started Free
              <ArrowRight className="ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <Button
              size="lg"
              variant="heroOutline"
              className="h-auto px-8 py-6 text-lg"
              onClick={() => setShowWaitlist(true)}
            >
              Join Waitlist
            </Button>
          </div>

          <div className="mt-8 text-sm text-muted-foreground">
            Be the first to know when we launch • Early access for waitlist
            members
          </div>

          <WaitlistDialog open={showWaitlist} onOpenChange={setShowWaitlist} />
        </div>
      </div>
    </section>
  )
}


