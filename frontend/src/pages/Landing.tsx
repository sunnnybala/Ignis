import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function Landing() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-2xl font-semibold">Ignis</CardTitle>
            <Badge variant="destructive">MVP</Badge>
          </div>
          <CardDescription>Go from idea to research paper in an instant.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Start a project and forge your paper with our agent-powered workspace.
          </p>
          <Button asChild>
            <Link to="/home">Enter app</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}


