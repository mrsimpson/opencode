export interface Session {
  hash: string;
  email: string;
  repoUrl: string;
  branch: string;
  state: "creating" | "running";
  url: string;
}

export interface SessionsResponse {
  email: string;
  sessions: Session[];
}

export async function listSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json();
}

export interface CreateSessionResponse {
  hash: string;
  url: string;
  state: "creating";
  error?: string;
}

export async function createSession(
  repoUrl: string,
  branch: string
): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to create session: ${res.status}`);
  }
  return res.json();
}

export async function getSessionState(
  hash: string
): Promise<{ hash: string; state: "creating" | "running"; url: string }> {
  const res = await fetch(`/api/sessions/${hash}`);
  if (!res.ok) throw new Error(`Failed to get session state: ${res.status}`);
  return res.json();
}
