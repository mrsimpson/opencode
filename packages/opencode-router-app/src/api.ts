export interface Session {
  hash: string
  email: string
  repoUrl: string
  /** Session branch — auto-generated unique name (e.g. "calm-snails-dream") */
  branch: string
  /** Source branch the session was created from (e.g. "main") */
  sourceBranch: string
  state: "creating" | "running" | "stopped"
  url: string
  lastActivity: string
  createdAt: string
  idleTimeoutMinutes: number
  description?: string
}

export interface SessionsResponse {
  email: string
  sessions: Session[]
}

const TIMEOUT_MS = 15_000

export async function listSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions", { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`)
  return res.json()
}

export interface CreateSessionResponse {
  hash: string
  url: string
  state: "creating"
  error?: string
}

export async function createSession(
  repoUrl: string,
  branch: string,
  sourceBranch: string,
  initialMessage?: string,
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch, sourceBranch, ...(initialMessage ? { initialMessage } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to create session: ${res.status}`)
  }
  return res.json()
}

export async function getSessionState(
  hash: string,
): Promise<{ hash: string; state: "creating" | "running" | "stopped"; url: string }> {
  const res = await fetch(`/api/sessions/${hash}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to get session state: ${res.status}`)
  return res.json()
}

export interface SessionEventHandlers {
  onProgress?: (stage: string, message: string) => void
  onStateChange?: (state: "creating" | "running" | "stopped") => void
  onComplete?: (url: string) => void
  onError?: (message: string) => void
}

/**
 * Subscribe to SSE session startup events from GET /api/sessions/:hash/events.
 * Returns the EventSource so the caller can close it on cleanup.
 *
 * Events received:
 *   progress     { stage, message }  — human-readable startup stage update
 *   state_change { state }           — pod state transition
 *   complete     { url }             — session ready; navigate to url
 *   error        { message }         — unrecoverable error
 */
export function subscribeSessionEvents(hash: string, handlers: SessionEventHandlers): EventSource {
  const es = new EventSource(`/api/sessions/${hash}/events`)

  es.addEventListener("progress", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { stage: string; message: string }
    handlers.onProgress?.(data.stage, data.message)
  })

  es.addEventListener("state_change", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { state: "creating" | "running" | "stopped" }
    handlers.onStateChange?.(data.state)
  })

  es.addEventListener("complete", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { url: string }
    es.close()
    handlers.onComplete?.(data.url)
  })

  es.addEventListener("error", (e) => {
    const raw = (e as MessageEvent).data
    const message = raw ? (JSON.parse(raw) as { message: string }).message : "Connection error"
    es.close()
    handlers.onError?.(message)
  })

  return es
}

export async function terminateSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}`, { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to terminate session: ${res.status}`)
  }
}

export async function resumeSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}/resume`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to resume session: ${res.status}`)
  }
}

export async function suggestBranch(repoUrl: string): Promise<{ branch: string }> {
  const params = new URLSearchParams({ repoUrl })
  const res = await fetch(`/api/sessions/suggest-branch?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to suggest branch: ${res.status}`)
  return res.json()
}

export interface Repo {
  name: string
  fullName: string
  url: string
  isPrivate: boolean
  defaultBranch: string
}

export interface Branch {
  name: string
}

export async function listUserRepos(): Promise<Repo[]> {
  const res = await fetch("/api/user/repos", { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list repos: ${res.status}`)
  return res.json()
}

export async function listRepoBranches(repoFullName: string): Promise<Branch[]> {
  const params = new URLSearchParams({ repo: repoFullName })
  const res = await fetch(`/api/user/repos/branches?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to list branches: ${res.status}`)
  return res.json()
}
