import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppHomeSidebar } from '@/components/AppHomeSidebar'
import { Routes, Route, Navigate } from 'react-router-dom'
import HomeProjects from './HomeProjects'
import HomeUsage from './HomeUsage'

export default function Home() {
  return (
    <SidebarProvider>
      <AppHomeSidebar />
      <main className="flex min-h-dvh w-full flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2">
          <SidebarTrigger />
          <h1 className="text-sm font-medium">Home</h1>
        </header>
        <div className="flex-1 p-6">
          <Routes>
            <Route index element={<Navigate to="projects" replace />} />
            <Route path="projects" element={<HomeProjects />} />
            <Route path="usage" element={<HomeUsage />} />
            <Route path="*" element={<Navigate to="projects" replace />} />
          </Routes>
        </div>
      </main>
    </SidebarProvider>
  )
}


