import { Search, Target, FlaskConical, FileText } from "lucide-react"

const steps = [
  {
    number: "01",
    icon: Search,
    title: "Find Previous Work",
    description:
      "Ignis scans millions of research papers to find all relevant prior work related to your idea.",
    color: "from-primary to-primary/60",
  },
  {
    number: "02",
    icon: Target,
    title: "Idea Refinement & Novelty Check",
    description:
      "We refine your initial concept and verify its novelty against existing research to ensure you're working on something truly original.",
    color: "from-primary/60 to-accent/70",
  },
  {
    number: "03",
    icon: FlaskConical,
    title: "Run Experiments",
    description:
      "Execute experiments in our secure sandbox environment with automated data collection and analysis.",
    color: "from-accent/70 to-secondary/70",
  },
  {
    number: "04",
    icon: FileText,
    title: "Generate Paper",
    description:
      "Get a publication-ready research paper with proper citations, methodology, and results.",
    color: "from-secondary/70 to-primary",
  },
] as const

export default function ProcessSteps() {
  return (
    <section id="steps" className="relative overflow-hidden px-4 py-24">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-card to-background" />

      <div className="container mx-auto relative z-10">
        <div className="mb-16 text-center animate-fade-in">
          <h2 className="mb-4 text-4xl font-bold md:text-5xl">
            Four Steps to Publication
          </h2>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            The entire research pipeline — automated end-to-end
          </p>
        </div>

        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <div
              key={step.number}
              className="group animate-slide-up"
              style={{ animationDelay: `${index * 150}ms` }}
            >
              <div className="relative h-full rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10">
                {/* Step number */}
                <div
                  className={`mb-4 text-6xl font-bold opacity-30 ${
                    step.title === "Idea Refinement & Novelty Check"
                      ? "bg-gradient-to-br from-white to-zinc-300"
                      : `bg-gradient-to-br ${step.color}`
                  } bg-clip-text text-transparent`}
                >
                  {step.number}
                </div>

                {/* Icon */}
                <div
                  className={`mb-6 w-16 rounded-xl p-3 transition-transform duration-300 group-hover:scale-110 ${
                    step.title === "Idea Refinement & Novelty Check"
                      ? "bg-gradient-to-br from-white to-zinc-300"
                      : `bg-gradient-to-br ${step.color}`
                  }`}
                >
                  <step.icon className="h-full w-full text-background" />
                </div>

                {/* Content */}
                <h3 className="mb-3 text-xl font-bold">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>

                {/* Connector line (hidden on last item on large screens) */}
                {index < steps.length - 1 ? (
                  <div className="absolute -right-4 top-1/2 hidden h-0.5 w-8 bg-gradient-to-r from-primary/50 to-transparent lg:block" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}


