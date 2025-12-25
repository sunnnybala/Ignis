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
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'

export function SidebarUserFooter({
}: {
  // no props: user comes from Supabase auth context
}) {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const name =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    (user?.email ? user.email.split('@')[0] : 'User')
  const email = user?.email || '—'
  const avatarUrl =
    (user?.user_metadata?.avatar_url as string | undefined) ||
    (user?.user_metadata?.picture as string | undefined) ||
    '/Ignis_Logo.png'

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

  const onLogout = async () => {
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent">
            <Avatar className="size-6">
              <AvatarImage src={avatarUrl} alt={name} />
              <AvatarFallback>
                {name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{name}</span>
            <ChevronUp className="ml-auto size-4 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleDarkMode}>Toggle dark mode</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void onLogout()}>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
  )
}


