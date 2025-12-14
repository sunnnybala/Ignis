import Navigation from "@/components/landing/Navigation"
import Hero from "@/components/landing/Hero"
import ProcessSteps from "@/components/landing/ProcessSteps"
import ProblemSolution from "@/components/landing/ProblemSolution"
import CTASection from "@/components/landing/CTASection"
import Footer from "@/components/landing/Footer"

export default function Landing() {
  return (
    <div className="landing-theme min-h-screen bg-background text-foreground">
      <Navigation />
      <Hero />
      <ProcessSteps />
      <ProblemSolution />
      <CTASection />
      <Footer />
    </div>
  )
}