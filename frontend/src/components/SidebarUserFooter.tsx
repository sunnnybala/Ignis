import { ChevronUp } from 'lucide-react'
import { SidebarFooter } from '@/components/ui/sidebar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type User = { name: string; email: string; avatarUrl?: string }

export function SidebarUserFooter({
  user,
  onLogout,
}: {
  user: User
  onLogout?: () => void
}) {
  const toggleDarkMode = () => {
    const root = document.documentElement
    root.classList.toggle('dark')
    try {
      const isDark = root.classList.contains('dark')
      localStorage.setItem('theme', isDark ? 'dark' : 'light')
    } catch (e) {
      void e
    }
  }

  return (
    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent">
            <Avatar className="size-6">
              <AvatarImage src={user.avatarUrl || '/Ignis_Logo.png'} alt={user.name} />
              <AvatarFallback>
                {user.name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{user.name}</span>
            <ChevronUp className="ml-auto size-4 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{user.name}</span>
              <span className="text-xs text-muted-foreground">{user.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleDarkMode}>Toggle dark mode</DropdownMenuItem>
          <DropdownMenuItem onClick={onLogout}>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
  )
}


