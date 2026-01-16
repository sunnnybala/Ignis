import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Editor, type OnMount } from '@monaco-editor/react'

import ChatPanel from '@/components/ChatPanel'
import {
  getProjectTree,
  getFile,
  saveFile,
  compileAthenaPaper,
  type AthenaMeta,
  type TreeNode,
  type FileRecord,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

const PAPER_PATH = 'Final_Paper/paper.tex'
const META_PATH = 'Final_Paper/paper_metadata.json'
const EDITABLE: Array<FileRecord['type']> = ['tex']

function debug(...args: any[]) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[athena]', ...args)
  }
}

function findFileIdByPath(nodes: TreeNode[] | undefined, targetPath: string): string | undefined {
  if (!nodes) return undefined
  const stack: TreeNode[] = [...nodes]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.kind === 'file') {
      if (n.path === targetPath) return n.fileId
    } else if (n.children && n.children.length) {
      for (const c of n.children) stack.push(c)
    }
  }
  return undefined
}

const JOURNALS = [
  'General',
  'Nature',
  'Science',
  'Cell',
  'PNAS',
  'Nature Communications',
  'IEEE TPAMI',
  'JMLR',
  'NeurIPS',
  'ICML',
  'ICLR',
] as const

export default function Athena() {
  const { projectId = '' } = useParams()

  const [journal, setJournal] = useState<(typeof JOURNALS)[number]>('General')
  const [meta, setMeta] = useState<AthenaMeta | null>(null)

  const [editorValue, setEditorValue] = useState<string>('')
  const [dirty, setDirty] = useState(false)
  const [file, setFile] = useState<FileRecord | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [isCompiling, setIsCompiling] = useState(false)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const skipAlertAtRef = useRef<number>(0)
  const prevViewerUrlRef = useRef<string | null>(null)

  useEffect(() => {
    debug('mount', { projectId })
    return () => debug('unmount', { projectId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const treeQ = useQuery({
    queryKey: ['files-tree', projectId],
    queryFn: () => getProjectTree(projectId),
    enabled: !!projectId,
  })

  const paperFileId = useMemo(() => findFileIdByPath(treeQ.data, PAPER_PATH), [treeQ.data])
  const metaFileId = useMemo(() => findFileIdByPath(treeQ.data, META_PATH), [treeQ.data])

  useEffect(() => {
    debug('tree', {
      status: treeQ.status,
      isLoading: treeQ.isLoading,
      isFetching: treeQ.isFetching,
      paperFileId,
      metaFileId,
    })
  }, [metaFileId, paperFileId, treeQ.isFetching, treeQ.isLoading, treeQ.status])

  const fileQ = useQuery({
    queryKey: ['file', paperFileId],
    queryFn: () => (paperFileId ? getFile(paperFileId) : Promise.resolve(null)),
    enabled: !!paperFileId,
  })

  const metaQ = useQuery({
    queryKey: ['file', metaFileId],
    queryFn: () => (metaFileId ? getFile(metaFileId) : Promise.resolve(null)),
    enabled: !!metaFileId,
  })

  const saveMut = useMutation({
    mutationFn: (payload: { id: string; content: string }) => saveFile(payload.id, payload.content),
    onSuccess: () => setSaving('saved'),
    onError: () => setSaving('idle'),
  })

  useEffect(() => {
    debug('mutationFlags', {
      saving,
      dirty,
    })
  }, [dirty, saving])

  const isEditable = useMemo(() => (file ? EDITABLE.includes(file.type) : false), [file])

  useEffect(() => {
    if (!fileQ.data) {
      setFile(null)
      setEditorValue('')
      setDirty(false)
      setSaving('idle')
      return
    }
    setFile(fileQ.data)
    setEditorValue(fileQ.data.content ?? '')
    setDirty(false)
    setSaving('idle')
  }, [fileQ.data])

  const flushSave = useCallback(async () => {
    if (!file || !isEditable || !dirty) return
    const content = editorValue ?? ''
    setSaving('saving')
    await saveMut.mutateAsync({ id: file.id, content })
    setDirty(false)
  }, [dirty, editorValue, file, isEditable, saveMut])

  // Revoke old blob URLs to avoid leaks
  useEffect(() => {
    const prev = prevViewerUrlRef.current
    if (prev && prev !== viewerUrl) {
      try {
        URL.revokeObjectURL(prev)
      } catch {
        // ignore
      }
    }
    prevViewerUrlRef.current = viewerUrl
  }, [viewerUrl])

  useEffect(() => {
    return () => {
      const prev = prevViewerUrlRef.current
      if (prev) {
        try {
          URL.revokeObjectURL(prev)
        } catch {
          // ignore
        }
      }
    }
  }, [])

  const ensureSavedBeforeAction = useCallback(async () => {
    // cancel any pending debounced save and flush immediately
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    if (!file || !isEditable) return
    if (!dirty) return
    debug('ensureSavedBeforeAction: flushing save', { projectId, fileId: file.id })
    await flushSave()
  }, [dirty, file, flushSave, isEditable, projectId])

  const ensureSavedBeforeChat = useCallback(async () => {
    // persist local edits before calling LLM
    await ensureSavedBeforeAction()
  }, [ensureSavedBeforeAction])

  const scheduleSave = useCallback(() => {
    if (!isEditable) return
    setDirty(true)
    setSaving('idle')
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave()
    }, 1000)
  }, [flushSave, isEditable])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Load meta from persisted file if present
  useEffect(() => {
    const content = metaQ.data?.content
    if (!content || typeof content !== 'string') return
    try {
      const parsed = JSON.parse(content) as AthenaMeta
      if (parsed && typeof parsed === 'object') {
        debug('meta.loadedFromFile', { projectId, parsed })
        setMeta({
          ...parsed,
          suggestedJournals: (parsed.suggestedJournals || []).slice(0, 3),
        })
        // Update journal dropdown if a valid journal is selected
        if (parsed.selectedJournal && (JOURNALS as readonly string[]).includes(parsed.selectedJournal)) {
          setJournal(parsed.selectedJournal as typeof journal)
        }
      }
    } catch {
      debug('meta.parseFailed', { projectId })
      // ignore parsing errors (meta remains null)
    }
  }, [metaQ.data?.content, projectId])

  // Listen for file tree refresh events from the router endpoint
  // This replaces the old file_update SSE handling since router uses this pattern
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail
      if (detail?.projectId !== projectId) return
      if (dirty) return // Don't overwrite local edits
      debug('ignis:refresh-files-tree received, refetching', { projectId })
      fileQ.refetch().catch(() => {})
      metaQ.refetch().catch(() => {})
      treeQ.refetch().catch(() => {})
    }
    document.addEventListener('ignis:refresh-files-tree', handler)
    return () => document.removeEventListener('ignis:refresh-files-tree', handler)
  }, [dirty, projectId, fileQ, metaQ, treeQ])

  // Handle file updates from SSE (for backwards compatibility if router ever emits these)
  const handleFileUpdate = useCallback(
    (ev: { path: string; op: 'append' | 'replace'; content: string }) => {
      if (ev.path === PAPER_PATH) {
        // If user has local edits, do not overwrite; alert once (rate-limited)
        if (dirty) {
          const now = Date.now()
          if (now - skipAlertAtRef.current > 1500) {
            skipAlertAtRef.current = now
            window.alert(
              'Assistant updated the paper, but you have unsaved local edits. Please save (Ctrl/Cmd+S) or wait for autosave, then resend/retry to apply updates.',
            )
          }
          return
        }
        // prevent queued save from firing
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = undefined
        }
        if (ev.op === 'replace') setEditorValue(ev.content)
        else setEditorValue((prev) => (prev ?? '') + ev.content)
        setDirty(false)
        setSaving('idle')
        return
      }

      if (ev.path === META_PATH) {
        // Update meta live, but do NOT change suggested journals due to chat edits.
        try {
          const parsed = JSON.parse(ev.content) as AthenaMeta
          setMeta((prev) => {
            const keepSuggested = prev?.suggestedJournals
            return {
              ...parsed,
              suggestedJournals: keepSuggested && keepSuggested.length > 0 ? keepSuggested.slice(0, 3) : (parsed.suggestedJournals || []).slice(0, 3),
            }
          })
        } catch {
          // ignore
        }
      }
    },
    [dirty],
  )

  const compilePdf = useCallback(async () => {
    try {
      if (!projectId) return
      debug('compile.click', { projectId, dirty, saving })
      // Save local edits before compiling to ensure backend compiles the latest LaTeX.
      await ensureSavedBeforeAction()
      debug('compile.afterSave', { projectId, dirty: false })
      setIsCompiling(true)
      const t0 = performance.now()
      const blob = await compileAthenaPaper(projectId)
      const ms = Math.round(performance.now() - t0)
      debug('compile.response', { projectId, ms, sizeBytes: blob.size, type: blob.type })
      const url = URL.createObjectURL(blob)
      setViewerUrl(url)
      debug('compile.viewerUrl.set', { projectId })
    } catch (err: unknown) {
      window.alert(`Failed to compile LaTeX: ${String((err as any)?.message || err)}`)
    } finally {
      setIsCompiling(false)
    }
  }, [ensureSavedBeforeAction, projectId, dirty, saving])

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void flushSave()
    })
  }

  const headerRight = (
    <div className="flex items-center gap-2">
      {saving === 'saving' ? (
        <span className="text-xs text-muted-foreground">Saving...</span>
      ) : saving === 'saved' ? (
        <span className="text-xs text-muted-foreground">Saved</span>
      ) : null}
    </div>
  )

  const isLoading = treeQ.isLoading || fileQ.isLoading

  return (
    <main className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="min-w-0">
          <h1 className="text-sm font-medium truncate">Athena - {projectId}</h1>
          <p className="text-xs text-muted-foreground truncate">{PAPER_PATH}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Paper</Badge>
        </div>
      </header>

      <div className="flex-1 min-w-0 overflow-hidden">
        <PanelGroup direction="horizontal" className="h-full w-full min-w-0 overflow-hidden">
          {/* Left: LaTeX editor */}
          <Panel defaultSize={33} minSize={20} className="min-w-0">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <p className="text-xs font-medium">LaTeX</p>
                <div className="flex items-center gap-2">
                  {headerRight}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void compilePdf()}
                    disabled={isCompiling}
                  >
                    {isCompiling ? 'Compiling...' : 'Compile LaTeX'}
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {isLoading ? (
                  <div className="p-4">
                    <Skeleton className="h-6 w-1/3" />
                    <Skeleton className="mt-3 h-72 w-full" />
                  </div>
                ) : file ? (
                  <Editor
                    height="100%"
                    language="markdown"
                    theme="vs-dark"
                    value={editorValue}
                    onMount={onMount}
                    onChange={(v) => {
                      setEditorValue(v ?? '')
                      scheduleSave()
                    }}
                    options={{
                      fontSize: 14,
                      minimap: { enabled: false },
                      wordWrap: 'on',
                      automaticLayout: true,
                    }}
                  />
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    No paper found. Ask the chat to write a paper for your research.
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="bg-border w-px" />

          {/* Middle: PDF preview + journal dropdown (display-only) */}
          <Panel defaultSize={34} minSize={20} className="min-w-0">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <p className="text-xs font-medium">Preview</p>
                <div className="flex items-center gap-2">
                  {meta ? (
                    <Badge variant="secondary">
                      Publish probability: {Math.round((meta.publicationProbability || 0) * 100)}%
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Publish: -</Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline">
                        Journal: {journal}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {JOURNALS.map((j) => (
                        <DropdownMenuItem
                          key={j}
                          onClick={() => {
                            debug('journal.select.click', { selected: j })
                            setJournal(j)
                            // Display-only: user can ask chat to reformat for this journal
                          }}
                        >
                          {j}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-4">
                {meta?.suggestedJournals && meta.suggestedJournals.length > 0 ? (
                  <div className="mb-3 text-xs text-muted-foreground">
                    Suggested journals: {meta.suggestedJournals.slice(0, 3).join(', ')}
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-muted-foreground">Suggested journals: -</div>
                )}
                {viewerUrl ? (
                  <iframe src={viewerUrl} className="h-full w-full rounded-lg border bg-muted/20" />
                ) : (
                  <div className="h-full w-full rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Click "Compile LaTeX" to generate a PDF preview.
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="bg-border w-px" />

          {/* Right: Chat (uses router endpoint, shared with Forge) */}
          <Panel defaultSize={33} minSize={20} className="min-w-0">
            <ChatPanel
              projectId={projectId}
              showActions={false}
              endpoint="router"
              beforeSend={ensureSavedBeforeChat}
              onFileUpdate={handleFileUpdate}
            />
          </Panel>
        </PanelGroup>
      </div>
    </main>
  )
}
