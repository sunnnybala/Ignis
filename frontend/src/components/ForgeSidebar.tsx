import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { getProjectTree, type TreeNode } from '@/lib/api'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar'
import { SidebarHeaderBrand } from '@/components/SidebarHeaderBrand'
import { SidebarUserFooter } from '@/components/SidebarUserFooter'
import { ChevronRight, File, FileCode, FileText, Image, Folder, FolderOpen } from 'lucide-react'

function fileIcon(type?: string) {
  switch (type) {
    case 'md':
    case 'txt':
    case 'tex':
      return FileText
    case 'py':
      return FileCode
    case 'img':
      return Image
    default:
      return File
  }
}

export default function ForgeSidebar({
  selectedFileId,
  onSelectFile,
}: {
  selectedFileId?: string
  onSelectFile?: (fileId: string) => void
}) {
  const { projectId = '' } = useParams()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['files-tree', projectId],
    queryFn: () => getProjectTree(projectId),
    enabled: !!projectId,
  })

  // Expanded set of folder paths
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  const didInitExpandRef = useRef(false)
  const didAutoSelectRef = useRef(false)

  // Default-expand top-level directories only once on initial data load
  useEffect(() => {
    if (!data || didInitExpandRef.current) return
    const next = new Set<string>()
    for (const node of data) {
      if (node.kind === 'dir') next.add(node.path)
    }
    setExpanded(next)
    didInitExpandRef.current = true
  }, [data])

  // Auto-select USER_GUIDE.md on initial load (if no file selected yet)
  useEffect(() => {
    if (!data || didAutoSelectRef.current || selectedFileId) return
    didAutoSelectRef.current = true // Mark as attempted regardless of outcome
    const guide = data.find((node) => node.kind === 'file' && node.name === 'USER_GUIDE.md')
    if (guide?.fileId) {
      onSelectFile?.(guide.fileId)
    }
  }, [data, selectedFileId, onSelectFile])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Listen for refresh signal after job completion
  useEffect(() => {
    const onRefresh = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string } | undefined
      if (!detail || !detail.projectId || detail.projectId === projectId) {
        refetch()
      }
    }
    document.addEventListener('ignis:refresh-files-tree', onRefresh as EventListener)
    return () => document.removeEventListener('ignis:refresh-files-tree', onRefresh as EventListener)
  }, [projectId, refetch])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeaderBrand />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarGroupContent>
            {isLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SidebarMenuSkeleton key={i} showIcon />
                ))}
              </div>
            ) : (
              <SidebarMenu>
                {(data || []).map((node) => (
                  <TreeItem
                    key={node.path}
                    node={node}
                    expanded={expanded}
                    onToggle={toggle}
                    selectedFileId={selectedFileId}
                    onSelectFile={onSelectFile}
                  />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarUserFooter />
    </Sidebar>
  )
}

function TreeItem({
  node,
  expanded,
  onToggle,
  selectedFileId,
  onSelectFile,
}: {
  node: TreeNode
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedFileId?: string
  onSelectFile?: (fileId: string) => void
}) {
  if (node.kind === 'file') {
    const Icon = fileIcon(node.type)
    const isActive = node.fileId === selectedFileId
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={node.name}
          isActive={isActive}
          onClick={() => node.fileId && onSelectFile?.(node.fileId)}
        >
          <Icon className="size-4" />
          <span>{node.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  // Folder
  const isOpen = expanded.has(node.path)
  const FolderIcon = isOpen ? FolderOpen : Folder

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={node.name} onClick={() => onToggle(node.path)}>
        <FolderIcon className="size-4" />
        <span>{node.name}</span>
        <ChevronRight
          className={`ml-auto size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </SidebarMenuButton>
      {isOpen && node.children && node.children.length > 0 && (
        <ul className="ml-6 mt-1 flex flex-col gap-1 group-data-[collapsible=icon]:hidden">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      )}
    </SidebarMenuItem>
  )
}


