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
  idleTimeoutMinutes: number
}

export interface SessionsResponse {
  email: string
  sessions: Session[]
}

export async function listSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions")
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
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch, sourceBranch }),
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
  const res = await fetch(`/api/sessions/${hash}`)
  if (!res.ok) throw new Error(`Failed to get session state: ${res.status}`)
  return res.json()
}

export async function terminateSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}`, { method: "DELETE" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to terminate session: ${res.status}`)
  }
}

export async function resumeSession(hash: string): Promise<void> {
  const res = await fetch(`/api/sessions/${hash}/resume`, { method: "POST" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Failed to resume session: ${res.status}`)
  }
}

export async function suggestBranch(repoUrl: string): Promise<{ branch: string }> {
  const params = new URLSearchParams({ repoUrl })
  const res = await fetch(`/api/sessions/suggest-branch?${params}`)
  if (!res.ok) throw new Error(`Failed to suggest branch: ${res.status}`)
  return res.json()
}
