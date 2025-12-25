import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, Folder } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { SidebarHeaderBrand } from '@/components/SidebarHeaderBrand'
import { SidebarUserFooter } from '@/components/SidebarUserFooter'

const menu = [
  { title: 'Projects', to: '/home/projects', icon: Folder },
  { title: 'Usage', to: '/home/usage', icon: BarChart3 },
]

export function AppHomeSidebar() {
  const location = useLocation()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeaderBrand />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menu.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname.startsWith(item.to)}>
                    <NavLink to={item.to} className="flex items-center gap-2">
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarUserFooter />
    </Sidebar>
  )
}


