import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import ForgeSidebar from '@/components/ForgeSidebar'
import ForgeMain from '@/components/ForgeMain'

export default function Forge() {
  const { projectId = '' } = useParams()
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>(undefined)

  return (
    <SidebarProvider>
      <ForgeSidebar selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} />
      <main className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b px-4 py-2">
          <SidebarTrigger />
          <h1 className="text-sm font-medium">Forge — {projectId}</h1>
        </header>
        <div className="flex-1 min-w-0 overflow-hidden">
          <ForgeMain selectedFileId={selectedFileId} projectId={projectId} />
        </div>
      </main>
    </SidebarProvider>
  )
}


