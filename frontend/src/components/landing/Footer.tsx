import { Flame } from "lucide-react"

export default function Footer() {
  return (
    <footer className="border-t border-border px-4 py-12">
      <div className="container mx-auto">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary">
              <Flame className="h-5 w-5 text-background" />
            </div>
            <span className="text-xl font-bold">Ignis</span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <a href="#about" className="transition-colors hover:text-foreground">
              About
            </a>
            <a href="#steps" className="transition-colors hover:text-foreground">
              Features
            </a>
          </div>

          {/* Copyright */}
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Ignis. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  )
}


