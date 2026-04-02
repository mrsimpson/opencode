export interface StatusResponse {
  email: string
  state: "none" | "creating" | "running"
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status")
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
  return res.json()
}

export interface CreateSessionResponse {
  ok: boolean
  error?: string
}

export async function createSession(repoUrl: string): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl }),
  })
  return res.json()
}
