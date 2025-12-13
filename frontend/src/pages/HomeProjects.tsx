import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, type Project } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import EmptyProjects from '@/components/EmptyProjects'
import { Skeleton } from '@/components/ui/skeleton'

export default function HomeProjects() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['projects'], queryFn: listProjects })

  const create = useMutation({
    mutationFn: (name: string) => createProject(name),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/forge/${res.id}`)
    },
  })

  const onCreate = () => create.mutate('Untitled Project')

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-9 w-32"><Skeleton className="h-9 w-32" /></div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    )
  }

  const projects = (data || []) as Project[]

  if (!projects.length) {
    return <EmptyProjects onCreate={onCreate} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Projects</h2>
        <Button onClick={onCreate}>Create Project</Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {projects.map((p) => (
          <button key={p.id} onClick={() => navigate(`/forge/${p.id}`)} className="text-left">
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold truncate">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}


