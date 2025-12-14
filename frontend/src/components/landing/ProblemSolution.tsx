import { AlertCircle, Zap } from "lucide-react"

export default function ProblemSolution() {
  return (
    <section id="about" className="relative px-4 py-24">
      <div className="container mx-auto max-w-6xl">
        <div className="grid items-center gap-12 md:grid-cols-2">
          {/* Problem */}
          <div className="animate-fade-in">
            <div className="mb-4 inline-flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                The Problem
              </span>
            </div>
            <h2 className="mb-6 text-3xl font-bold md:text-4xl">
              Research is Painfully Slow
            </h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                Researchers spend months conducting literature reviews, refining
                ideas, checking novelty, designing experiments, and writing
                papers.
              </p>
              <p>
                The current process is manual, time-consuming, and prone to
                missing critical prior work, pursuing non-novel ideas, or
                overlooking potential research directions.
              </p>
              <p>
                There is no comprehensive tool that automates the entire research
                pipeline.
              </p>
            </div>
          </div>

          {/* Solution */}
          <div
            className="animate-fade-in"
            style={{ animationDelay: "200ms" }}
          >
            <div className="mb-4 inline-flex items-center gap-2 text-accent">
              <Zap className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                The Solution
              </span>
            </div>
            <h2 className="mb-6 text-3xl font-bold md:text-4xl">
              End-to-End Automation
            </h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                Ignis is the first platform to automate the entire research
                workflow from initial concept to publication-ready paper.
              </p>
              <p>
                Our AI-powered system comprehensively analyzes existing research,
                refines your ideas, validates novelty, executes experiments in a
                secure sandbox, and generates properly formatted research papers.
              </p>
              <p className="font-semibold text-foreground">
                What takes months now takes minutes.
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-20 grid max-w-5xl grid-cols-1 gap-8 animate-slide-up sm:grid-cols-2 md:grid-cols-3">
          {[
            { value: "10,000+", label: "Research Papers Analyzed" },
            { value: "95%", label: "Time Saved" },
            { value: "100%", label: "End-to-End Automation" },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-card p-6 text-center"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="mb-2 bg-gradient-primary bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}


