import { supabase } from '@/lib/supabaseClient'
import { getAuthHeaders } from '@/lib/authHeaders'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:4000'

function warnApi(event: string, fields: Record<string, unknown>) {
  // Keep this as warn even in prod; it helps diagnose auth/config issues without leaking secrets.
  // eslint-disable-next-line no-console
  console.warn(`[warn] api.${event}`, fields)
}

function redirectToLoginIfNeeded() {
  // Avoid redirect loops on the login page.
  if (window.location.pathname.startsWith('/login')) return
  const from = window.location.pathname + window.location.search
  window.location.replace(`/login?from=${encodeURIComponent(from)}`)
}

async function handleErrorResponse(resp: Response, path: string): Promise<never> {
  const requestId = resp.headers.get('x-request-id') || ''
  if (resp.status === 401) {
    warnApi('error', { path, status: resp.status, requestId })
    // Best-effort signout: clears any stale local session.
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore
    }
    redirectToLoginIfNeeded()
    throw new Error(`HTTP 401`)
  }

  warnApi('error', { path, status: resp.status, requestId })
  throw new Error(`HTTP ${resp.status}${requestId ? ` (x-request-id: ${requestId})` : ''}`)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await getAuthHeaders()
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...auth, ...(init?.headers || {}) },
    ...init,
  })
  if (!resp.ok) await handleErrorResponse(resp, path)
  return resp.json() as Promise<T>
}

async function apiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const auth = await getAuthHeaders()
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...auth, ...(init?.headers || {}) },
  })
  if (!resp.ok) {
    // try to surface JSON error bodies, fallback to status
    let details = ''
    try {
      const txt = await resp.text()
      details = txt ? ` — ${txt.slice(0, 2000)}` : ''
    } catch {
      // ignore
    }
    if (resp.status === 401) {
      const requestId = resp.headers.get('x-request-id') || ''
      warnApi('error', { path, status: resp.status, requestId })
      try {
        await supabase.auth.signOut()
      } catch {
        // ignore
      }
      redirectToLoginIfNeeded()
      throw new Error(`HTTP 401${details}`)
    }
    const requestId = resp.headers.get('x-request-id') || ''
    warnApi('error', { path, status: resp.status, requestId })
    throw new Error(`HTTP ${resp.status}${details}${requestId ? ` (x-request-id: ${requestId})` : ''}`)
  }
  return resp.blob()
}

export type Project = { id: string; name: string; userId: string; createdAt?: string }

export function listProjects() {
  return api<Project[]>('/projects')
}

export function createProject(name: string) {
  return api<{ id: string; name: string; userId: string }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export type TreeNode = {
  kind: 'dir' | 'file'
  name: string
  path: string
  children?: TreeNode[]
  fileId?: string
  type?: string
}

export function getProjectTree(projectId: string) {
  return api<TreeNode[]>('/projects/' + projectId + '/files/tree')
}

export type FileRecord = {
  id: string
  projectId: string
  path: string
  type: 'txt' | 'md' | 'py' | 'tex' | 'pdf' | 'img' | 'csv' | 'log' | 'other'
  content?: string | null
  storageKey?: string | null
  mimeType?: string | null
}

export function getFile(fileId: string) {
  return api<FileRecord>('/files/' + fileId)
}

export function saveFile(fileId: string, content: string) {
  return api<{ ok: true }>('/files/' + fileId, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function getFileUrl(fileId: string, expires = 300) {
  return api<{ signedUrl: string; expires: number }>('/files/' + fileId + '/url?expires=' + expires)
}

export function runExperiment(projectId: string) {
  return api<{ jobId: string; runId: string }>('/jobs/experiment/' + projectId + '/run', {
    method: 'POST',
  })
}

export function compilePaper(projectId: string) {
  return api<{ jobId: string }>('/jobs/paper/' + projectId + '/compile', {
    method: 'POST',
  })
}

export function generatePaper(projectId: string) {
  return api<{ ok: true }>('/jobs/paper/' + projectId + '/generate', {
    method: 'POST',
  })
}

export type AthenaMeta = {
  publicationProbability: number
  suggestedJournals: string[]
  selectedJournal: string
  hasResults?: boolean
  notes?: string
}

export function compileAthenaPaper(projectId: string) {
  return apiBlob('/paper/' + projectId + '/compile', {
    method: 'POST',
  })
}

export type JobRecord = {
  id: string
  projectId: string
  type: 'experiment_run' | 'paper_compile'
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt?: string | null
  endedAt?: string | null
  output?: string | null
}

export function getJob(jobId: string) {
  return api<JobRecord>('/jobs/' + jobId)
}


