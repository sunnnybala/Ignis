import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Sparkles } from "lucide-react"

import heroImage from "@/assets/hero-bg.jpg"
import { Button } from "@/components/ui/button"
import WaitlistDialog from "@/components/landing/WaitlistDialog"

export default function Hero() {
  const [showWaitlist, setShowWaitlist] = useState(false)
  const navigate = useNavigate()

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Background with gradient overlay */}
      <div className="absolute inset-0 bg-gradient-hero">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${heroImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_top,hsl(263_70%_50%/_0.15),transparent_55%)]" />
      </div>

      {/* Animated gradient orbs */}
      <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-float rounded-full bg-primary/30 blur-3xl" />
      <div
        className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-float rounded-full bg-accent/20 blur-3xl"
        style={{ animationDelay: "1s" }}
      />

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-20 text-center">
        <div className="animate-fade-in">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/50 px-4 py-2 backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              Revolutionizing Research Automation
            </span>
          </div>

          <h1 className="mb-6 bg-gradient-primary bg-clip-text text-5xl font-bold leading-tight text-transparent md:text-7xl">
            From Idea to Research Paper
            <br />
            in an Instant
          </h1>

          <p className="mx-auto mb-12 max-w-3xl text-xl text-muted-foreground md:text-2xl">
            Ignis automates your entire research pipeline. Find previous work,
            refine your idea, check novelty, run experiments, and generate
            publication-ready papers — all powered by AI.
          </p>

          <div
            className="flex animate-fade-in flex-col items-center justify-center gap-4 sm:flex-row"
            style={{ animationDelay: "400ms" }}
          >
            <Button
              size="lg"
              variant="hero"
              className="group h-auto px-8 py-6 text-lg"
              onClick={() => navigate("/register?from=%2Fhome%2Fprojects")}
            >
              Start Your Research
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

          <div className="mt-12 text-sm text-muted-foreground">
            Join researchers automating their workflow • Be first to know when we
            launch
          </div>
        </div>
      </div>

      <WaitlistDialog open={showWaitlist} onOpenChange={setShowWaitlist} />
    </section>
  )
}


