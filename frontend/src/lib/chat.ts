import type { ChatSseEvent } from './chatTypes'
import { getAuthHeaders } from '@/lib/authHeaders'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:4000'

export type ChatHistoryItem = { role: 'user' | 'assistant'; text: string }

/**
 * POSTs a chat message and streams back SSE events.
 * - Only standardized events are expected from the server:
 *   delta, file_update, phase, proposed_phase, await_user, action_request
 * - Heartbeats are sent as SSE comments (lines starting with ':'), which are ignored.
 */
export async function postChatStream(
  endpointBase: 'agent' | 'router',
  projectId: string,
  body: { message: string; history?: ChatHistoryItem[] },
  onEvent: (ev: ChatSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const auth = await getAuthHeaders()
  const resp = await fetch(`${API_BASE}/${endpointBase}/${projectId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...auth,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  if (!resp.body) {
    // Should not happen under modern browsers; fail fast
    throw new Error('No response body for SSE stream')
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let dataBuffer: string[] = []

  const flushEvent = () => {
    if (dataBuffer.length === 0) return
    const raw = dataBuffer.join('\n')
    dataBuffer = []
    if (!raw) return
    try {
      const ev = JSON.parse(raw) as ChatSseEvent
      onEvent(ev)
    } catch {
      // swallow parse errors; stream should continue
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx = buffer.indexOf('\n')
      while (idx !== -1) {
        let line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        // Trim trailing CR (for \r\n)
        if (line.endsWith('\r')) line = line.slice(0, -1)

        if (line.startsWith(':')) {
          // comment/heartbeat; ignore
        } else if (line.startsWith('data:')) {
          // strip "data:" and one leading space if present
          const content = line.slice(5).replace(/^\s/, '')
          dataBuffer.push(content)
        } else if (line === '') {
          // blank line -> dispatch event
          flushEvent()
        }

        idx = buffer.indexOf('\n')
      }
    }
    // End of stream; flush any pending event
    flushEvent()
  } catch (err: unknown) {
    // Abort errors are expected on cancel; rethrow others
    if (!(signal && signal.aborted)) {
      throw err
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}


