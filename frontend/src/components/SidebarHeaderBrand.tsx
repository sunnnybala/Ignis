import { SidebarHeader } from '@/components/ui/sidebar'

export function SidebarHeaderBrand() {
  return (
    <SidebarHeader>
      <div className="flex items-center gap-2 px-2">
        <img
          src="/Ignis_Logo.png"
          alt="Ignis logo"
          className="h-5 w-5 rounded-sm"
          loading="eager"
          decoding="async"
        />
        <span className="font-semibold group-data-[collapsible=icon]:hidden">IGNIS</span>
      </div>
    </SidebarHeader>
  )
}


