import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Editor, type OnMount } from '@monaco-editor/react'
import { getFile, getFileUrl, saveFile, type FileRecord } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Skeleton } from '@/components/ui/skeleton'
import ChatPanel from '@/components/ChatPanel'
import MarkdownPreview from '@/components/MarkdownPreview'

const EDITABLE: Array<FileRecord['type']> = ['txt', 'md', 'py', 'tex']

function languageFor(type: FileRecord['type']): string {
  switch (type) {
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'tex':
      // Monaco has no built-in LaTeX; markdown is a decent fallback for MVP
      return 'markdown'
    case 'txt':
    default:
      return 'plaintext'
  }
}

export default function ForgeMain({ selectedFileId, projectId }: { selectedFileId?: string; projectId: string }) {
  const qc = useQueryClient()
  const [editorValue, setEditorValue] = useState<string>('')
  const [dirty, setDirty] = useState(false)
  const [file, setFile] = useState<FileRecord | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const prevFileIdRef = useRef<string | undefined>(undefined)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const editorValueRef = useRef<string>('')
  const dirtyRef = useRef(false)

  const updateEditorValue = useCallback((value: string) => {
    setEditorValue(value)
    editorValueRef.current = value
  }, [])

  const updateDirty = useCallback((value: boolean) => {
    setDirty(value)
    dirtyRef.current = value
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['file', selectedFileId],
    queryFn: () => (selectedFileId ? getFile(selectedFileId) : Promise.resolve(null)),
    enabled: !!selectedFileId,
  })

  const saveMut = useMutation({
    mutationFn: (payload: { id: string; content: string }) => saveFile(payload.id, payload.content),
    onSuccess: () => setSaving('saved'),
    onError: () => setSaving('idle'),
  })

  const isEditable = useMemo(() => (file ? EDITABLE.includes(file.type) : false), [file])

  const flushSave = useCallback(() => {
    if (!file || !isEditable || !dirtyRef.current) return
    const content = editorValueRef.current
    setSaving('saving')
    saveMut.mutate({ id: file.id, content })
    updateDirty(false)
  }, [file, isEditable, saveMut, updateDirty])

  // Load file into editor/viewer when selection changes
  useEffect(() => {
    // Save previous if dirty
    if (prevFileIdRef.current && prevFileIdRef.current !== selectedFileId && dirty) {
      flushSave()
    }
    prevFileIdRef.current = selectedFileId
  }, [selectedFileId, dirty, flushSave])

  useEffect(() => {
    if (!data) {
      setFile(null)
      updateEditorValue('')
      setViewerUrl(null)
      updateDirty(false)
      return
    }
    setFile(data)
    updateDirty(false)
    setSaving('idle')
    // Reset to preview mode when opening a markdown file
    if (data.type === 'md') {
      setViewMode('preview')
    }
    if (EDITABLE.includes(data.type)) {
      updateEditorValue(data.content ?? '')
      setViewerUrl(null)
    } else {
      updateEditorValue('')
      // Load signed URL for pdf/img
      if (data.type === 'pdf' || data.type === 'img') {
        getFileUrl(data.id).then((res) => setViewerUrl(res.signedUrl)).catch(() => setViewerUrl(null))
      } else {
        setViewerUrl(null)
      }
    }
  }, [data, updateDirty, updateEditorValue])

  // Debounced save on content change
  const scheduleSave = useCallback(() => {
    if (!isEditable) return
    updateDirty(true)
    setSaving('idle')
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      flushSave()
    }, 1000)
  }, [flushSave, isEditable, updateDirty])

  // Apply server-driven file updates when safe (not dirty and editable)
  const handleFileUpdate = useCallback(
    (ev: { path: string; op: 'append' | 'replace'; content: string }) => {
      if (!file) return
      if (file.path !== ev.path) return
      if (!isEditable) return
      if (dirty) return
      // prevent queued save from firing
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = undefined
      }
      if (ev.op === 'replace') {
        updateEditorValue(ev.content)
      } else {
        updateEditorValue((editorValueRef.current ?? '') + ev.content)
      }
      updateDirty(false)
      setSaving('idle')
    },
    [dirty, file, isEditable, updateDirty, updateEditorValue],
  )

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  // When the router finishes (ChatPanel dispatches ignis:refresh-files-tree), refresh the currently open file
  // if it's safe (not dirty). This approximates file_update streaming without complicating SSE plumbing.
  useEffect(() => {
    const handler = (ev: Event) => {
      const project = (ev as any)?.detail?.projectId
      if (!project || project !== projectId) return
      if (!selectedFileId) return
      if (dirty) return
      qc.invalidateQueries({ queryKey: ['file', selectedFileId] })
    }
    document.addEventListener('ignis:refresh-files-tree', handler as any)
    return () => document.removeEventListener('ignis:refresh-files-tree', handler as any)
  }, [dirty, projectId, qc, selectedFileId])

  const onMount: OnMount = (editor, monaco) => {
    // Ctrl/Cmd+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      flushSave()
    })
  }

  const headerRight = (
    <div className="flex items-center gap-3">
      {!isEditable && file ? <Badge variant="secondary">Read-only</Badge> : null}
      <span className="text-xs text-muted-foreground w-12">
        {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}
      </span>
      {file?.type === 'md' && (
        <ButtonGroup>
          <Button
            variant={viewMode === 'preview' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('preview')}
          >
            Preview
          </Button>
          <Button
            variant={viewMode === 'code' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('code')}
          >
            Code
          </Button>
        </ButtonGroup>
      )}
    </div>
  )

  return (
    <PanelGroup direction="horizontal" className="h-full w-full min-w-0 overflow-hidden">
      <Panel defaultSize={70} minSize={40} className="min-w-0">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{file?.path || 'No file selected'}</p>
            </div>
            {headerRight}
          </div>
          <div className="flex-1 min-h-0">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="mt-3 h-72 w-full" />
              </div>
            ) : file ? (
              file.type === 'md' && viewMode === 'preview' ? (
                <MarkdownPreview content={editorValue} />
              ) : isEditable ? (
                <Editor
                  height="100%"
                  language={languageFor(file.type)}
                  theme="vs-dark"
                  value={editorValue}
                  onMount={onMount}
                  onChange={(v) => {
                    updateEditorValue(v ?? '')
                    scheduleSave()
                  }}
                  options={{
                    fontSize: 14,
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              ) : file.type === 'pdf' && viewerUrl ? (
                <iframe src={viewerUrl} className="h-full w-full" />
              ) : file.type === 'img' && viewerUrl ? (
                <div className="flex h-full w-full items-center justify-center bg-muted/30">
                  <img src={viewerUrl} alt={file.path} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">This file type is not editable.</div>
              )
            ) : (
              <div className="p-4 text-sm text-muted-foreground">Select a file from the sidebar.</div>
            )}
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="bg-border w-px" />
      <Panel defaultSize={30} minSize={20}>
        <ChatPanel projectId={projectId} onFileUpdate={handleFileUpdate} endpoint="router" />
      </Panel>
    </PanelGroup>
  )
}


