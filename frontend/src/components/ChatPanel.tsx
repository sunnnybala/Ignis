import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getJob, listProjects, runExperiment } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { ArrowUpIcon } from 'lucide-react'
import { IconPlus } from '@tabler/icons-react'
import { postChatStream } from '@/lib/chat'
import type { AgentPhase, ChatSseEvent } from '@/lib/chatTypes'
import { useNavigate } from 'react-router-dom'

type Message = { id: string; role: 'user' | 'assistant'; text: string }

export default function ChatPanel({
  projectId,
  onFileUpdate,
  showActions = true,
  endpoint = 'agent',
  beforeSend,
}: {
  projectId: string
  onFileUpdate?: (ev: { path: string; op: 'append' | 'replace'; content: string }) => void
  showActions?: boolean
  endpoint?: 'agent' | 'router'
  beforeSend?: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: listProjects })
  const projectName = useMemo(() => projects?.find((p) => p.id === projectId)?.name ?? 'Project', [projects, projectId])

  const [messages, setMessages] = useState<Message[]>([])
  const [mode, setMode] = useState<'Auto' | 'Agent' | 'Ask'>('Auto')
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<AgentPhase | ''>('')
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)

  // Load messages from localStorage on mount (shared between Forge and Athena)
  useEffect(() => {
    const stored = localStorage.getItem(`ignis-chat-${projectId}`)
    if (stored) {
      try {
        setMessages(JSON.parse(stored) as Message[])
      } catch {
        // ignore invalid stored data
      }
    }
  }, [projectId])

  // Persist messages to localStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`ignis-chat-${projectId}`, JSON.stringify(messages))
    }
  }, [messages, projectId])

  const scrollToBottom = () => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      scrollToBottom()
    })
    return () => cancelAnimationFrame(frameId)
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    // Build prior history BEFORE adding the new user message to avoid duplication
    const prior = messages.map((m) => ({ role: m.role, text: m.text }))
    const id = crypto.randomUUID()
    setMessages((prev) => [...prev, { id, role: 'user', text }])
    setInput('')

    const ac = new AbortController()
    abortRef.current = ac
    setIsStreaming(true)
    currentAssistantIdRef.current = null

    // Ensure any hosting page (e.g. Athena) can persist its editor state before we call the LLM.
    if (beforeSend) {
      try {
        await beforeSend()
      } catch (err: unknown) {
        setIsStreaming(false)
        abortRef.current = null
        currentAssistantIdRef.current = null
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Error: Failed to save before sending. ${String((err as any)?.message || err)}`,
          },
        ])
        return
      }
    }

    const onEvent = (ev: ChatSseEvent) => {
      if (ev.type === 'delta') {
        // Ensure an assistant message exists for this turn
        if (!currentAssistantIdRef.current) {
          const aid = crypto.randomUUID()
          currentAssistantIdRef.current = aid
          setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: '' }])
        }
        const msgId = currentAssistantIdRef.current
        if (!msgId) return
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, text: (m.text || '') + ev.text } : m)),
        )
        return
      }
      if (ev.type === 'final') {
        const finalText = String(ev.text ?? '')
        // If no assistant message was created (common when backend only emits "final"),
        // create one and set the full text.
        if (!currentAssistantIdRef.current) {
          const aid = crypto.randomUUID()
          currentAssistantIdRef.current = aid
          setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: finalText }])
          return
        }
        const msgId = currentAssistantIdRef.current
        if (!msgId) return
        // Replace with full final text (may duplicate prior streamed deltas; this keeps UI correct).
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, text: finalText } : m)))
        return
      }
      if (ev.type === 'await_user') {
        let text = ''
        if (ev.questions && ev.questions.length > 0) {
          text = ['I need a few details:', ...ev.questions.map((q) => `- ${q}`)].join('\n')
        } else if (ev.prompt) {
          text = ev.prompt
          if (ev.choices && ev.choices.length > 0) {
            text += `\nChoices: ${ev.choices.join(', ')}`
          }
        } else {
          text = 'Please provide the requested information.'
        }
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text }])
        return
      }
      if (ev.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${ev.message}` },
        ])
        return
      }
      if (ev.type === 'phase') {
        setPhase(ev.phase)
        return
      }
      if (ev.type === 'proposed_phase') {
        if (import.meta.env.DEV) {
          console.log('proposed_phase', ev)
        }
        return
      }
      if (ev.type === 'action_request') {
        const text = `Agent requested action: ${ev.action} — rationale: ${ev.rationale}`
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text }])
        return
      }
      if (ev.type === 'file_update') {
        onFileUpdate?.(ev)
        return
      }
    }

    const body = endpoint === 'router' ? { message: text } : { message: text, history: prior }
    postChatStream(endpoint, projectId, body, onEvent, ac.signal)
      .catch((err) => {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${String(err?.message || err)}` },
        ])
      })
      .finally(() => {
        setIsStreaming(false)
        abortRef.current = null
        currentAssistantIdRef.current = null

        // Router doesn't currently stream file_update events. Refresh the Forge sidebar (and any listeners)
        // after the response completes so new/updated artifacts show up.
        if (endpoint === 'router' && !ac.signal.aborted) {
          document.dispatchEvent(new CustomEvent('ignis:refresh-files-tree', { detail: { projectId } }))
        }
      })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const stop = () => {
    if (abortRef.current) {
      try {
        abortRef.current.abort()
      } catch {
        // ignore
      }
      abortRef.current = null
    }
    setIsStreaming(false)
    currentAssistantIdRef.current = null
  }

  const runExpMut = useMutation({
    mutationFn: () => runExperiment(projectId),
    onSuccess: (res) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `Experiment enqueued. jobId=${res.jobId}` },
      ])
      pollJob(res.jobId, res.runId)
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: 'Failed to enqueue experiment.' },
      ])
    },
  })

  // Poll job status and refresh the file tree when done
  const pollJob = (jobId: string, runId?: string) => {
    const start = Date.now()
    const interval = setInterval(async () => {
      try {
        const j = await getJob(jobId)
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(interval)
          // Advise the user and trigger sidebar refresh via a synthetic assistant message
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text:
                j.status === 'completed'
                  ? `Experiment completed. Check Results/${runId || jobId}/`
                  : `Experiment failed. See Results/${runId || jobId}/results.txt`,
            },
          ])
          // Invalidate files tree query so ForgeSidebar refreshes
          // Fallback: notify via a custom event; ForgeSidebar queries are keyed by ['files-tree', projectId]
          document.dispatchEvent(new CustomEvent('ignis:refresh-files-tree', { detail: { projectId } }))
        }
        // protective timeout
        if (Date.now() - start > 5 * 60 * 1000) {
          clearInterval(interval)
        }
      } catch {
        // ignore transient errors
      }
    }, 1500)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <p className="truncate text-xs font-medium">{projectName}</p>
        <Badge variant="verified">{phase || '—'}</Badge>
      </div>
      {showActions ? (
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button size="sm" onClick={() => runExpMut.mutate()} disabled={runExpMut.isPending || isStreaming}>
          Run experiment
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate(`/athena/${projectId}`)}
          disabled={isStreaming}
        >
          Edit paper
        </Button>
      </div>
      ) : null}
      <div ref={listRef} className="flex-1 min-w-0 min-h-0 overflow-auto overflow-x-hidden px-3 py-3">
        <div className="flex min-w-0 flex-col gap-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user' ? 'self-end rounded-br-md' : 'self-start rounded-bl-md'
              }`}
            >
              {/* {m.role === 'assistant' ? <MarkdownMessage text={m.text} /> : m.text} */}
              {m.text}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t p-3">
        <InputGroup className="w-full min-w-0">
          <InputGroupTextarea
            placeholder="Enter your idea in detail"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-32 w-full min-w-0 resize-none overflow-y-auto"
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              variant="outline"
              className="rounded-full"
              size="icon-xs"
              aria-label="Attach"
            >
              <IconPlus />
            </InputGroupButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton variant="ghost">{mode}</InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem]">
                {(['Auto', 'Agent', 'Ask'] as const).map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => setMode(opt)}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              variant="default"
              className="rounded-full ml-auto"
              size="icon-xs"
              aria-label="Send"
              disabled={!input.trim() || isStreaming}
              onClick={() => void send()}
            >
              <ArrowUpIcon />
              <span className="sr-only">Send</span>
            </InputGroupButton>
            {isStreaming ? (
              <InputGroupButton
                variant="destructive"
                className="rounded-full"
                size="icon-xs"
                aria-label="Stop"
                onClick={stop}
              >
                Stop
              </InputGroupButton>
            ) : null}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
