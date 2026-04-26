import type http from "node:http"
import * as fs from "node:fs"
import { config } from "./config.js"
import {
  type SessionKey,
  RemoteRefsUnreachableError,
  ensurePVC,
  ensurePod,
  getPodState,
  getSessionHash,
  listUserSessions,
  remoteBranchExists,
  terminateSession,
  resumeSession,
  suggestBranch,
} from "./pod-manager.js"

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}

function errorCode(err: unknown): string {
  if (err instanceof Error) return err.message
  return "Unknown"
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf-8")
}

/** Build the public URL for a session subdomain. */
function sessionUrl(hash: string): string {
  return `${config.routerProto}://${hash}${config.routeSuffix}.${config.routerDomain}`
}

/**
 * Read listening ports from /proc/net/tcp and filter for ports >3000.
 * Used by the Cloudflare operator to discover user-started dev servers.
 */
async function getListeningPorts(): Promise<number[]> {
  const MIN_PORT = 3000
  try {
    const content = await fs.promises.readFile("/proc/net/tcp", "utf-8")
    const ports = new Set<number>()

    for (const line of content.split("\n").slice(1)) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // /proc/net/tcp format: sl local_address rem_address st ...
      // local_address is hex:IP (e.g., "00000000:1BB0" = 0.0.0.0:7104)
      const parts = trimmed.split(/\s+/)
      const localAddr = parts[1] ?? ""
      const hexPort = localAddr.split(":")[1]
      if (!hexPort) continue

      const port = parseInt(hexPort, 16)
      // Filter: port >3000 and valid (1024-65535)
      if (port > MIN_PORT && port > 1024 && port <= 65535) {
        ports.add(port)
      }
    }

    return Array.from(ports).sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * Handle API routes. Returns true if the route was handled.
 *
 * Routes:
 *   GET  /api/sessions          → list all sessions for the authenticated user
 *   POST /api/sessions          → create a session {repoUrl, branch} → {hash, url, state}
 *   GET  /api/sessions/:hash    → get state of a specific session
 */
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  email: string,
  githubToken?: string,
): Promise<boolean> {
  const url = req.url ?? "/"

  // GET /api/ports — return listening ports >3000 from /proc/net/tcp
  if (url === "/api/ports" && req.method === "GET") {
    const ports = await getListeningPorts()
    json(res, 200, { ports })
    return true
  }

  // GET /api/sessions — list all sessions for this user, always includes email
  if (url === "/api/sessions" && req.method === "GET") {
    try {
      const sessions = await listUserSessions(email, req)
      json(res, 200, { email, sessions })
    } catch (err) {
      console.error("listUserSessions failed:", err)
      json(res, 500, { error: "Failed to list sessions" })
    }
    return true
  }

  // POST /api/sessions — create a new session
  if (url === "/api/sessions" && req.method === "POST") {
    const raw = await readBody(req)
    let repoUrl: string
    let branch: string
    let sourceBranch: string
    let initialMessage: string
    try {
      const body = JSON.parse(raw)
      repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : ""
      branch = typeof body.branch === "string" ? body.branch.trim() : ""
      sourceBranch = typeof body.sourceBranch === "string" ? body.sourceBranch.trim() : ""
      initialMessage = typeof body.initialMessage === "string" ? body.initialMessage.trim() : ""
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }

    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" })
      return true
    }
    if (!branch) {
      json(res, 400, { error: "branch is required" })
      return true
    }
    if (!sourceBranch) {
      json(res, 400, { error: "sourceBranch is required" })
      return true
    }

    // Verify the source branch actually exists on the remote BEFORE creating PVC/pod.
    // Otherwise the pod's init container crashloops on `git checkout -B <sourceBranch> origin/<sourceBranch>`.
    try {
      const exists = await remoteBranchExists(repoUrl, sourceBranch)
      if (!exists) {
        json(res, 400, { error: `Branch "${sourceBranch}" not found on ${repoUrl}` })
        return true
      }
    } catch (err) {
      if (err instanceof RemoteRefsUnreachableError) {
        json(res, 502, { error: err.message })
        return true
      }
      throw err
    }

    const session: SessionKey = { email, repoUrl, branch, sourceBranch, initialMessage: initialMessage || undefined }
    const hash = getSessionHash(email, repoUrl, branch)

    await ensurePVC(session)
    await ensurePod(session, githubToken)

    json(res, 201, { hash, url: sessionUrl(hash), state: "creating" })
    return true
  }

  // GET /api/sessions/suggest-branch — must be before /:hash regex
  if (url.startsWith("/api/sessions/suggest-branch") && req.method === "GET") {
    const repoUrl = new URL(url, "http://localhost").searchParams.get("repoUrl")
    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" })
      return true
    }
    const branch = await suggestBranch(email, repoUrl)
    json(res, 200, { branch })
    return true
  }

  // GET /api/sessions/:hash — get state of a specific session
  const sessionMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})$/)
  if (sessionMatch && req.method === "GET") {
    const hash = sessionMatch[1]
    const sessions = await listUserSessions(email, req)
    const session = sessions.find((s) => s.hash === hash)
    if (session) {
      json(res, 200, session)
      return true
    }
    // Fallback: not owned by this user but hash exists
    const state = await getPodState(hash)
    json(res, 200, {
      hash,
      state,
      url: sessionUrl(hash),
      lastActivity: new Date().toISOString(),
      idleTimeoutMinutes: config.idleTimeoutMinutes,
    })
    return true
  }

  // POST /api/sessions/:hash/resume
  const resumeMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/resume$/)
  if (resumeMatch && req.method === "POST") {
    const hash = resumeMatch[1]
    try {
      await resumeSession(hash, email, githubToken)
    } catch (err) {
      const code = errorCode(err)
      if (code === "Forbidden") {
        json(res, 403, { error: "Forbidden" })
        return true
      }
      if (code === "NotFound") {
        json(res, 404, { error: "Not found" })
        return true
      }
      throw err
    }
    json(res, 200, { hash, state: "creating", url: sessionUrl(hash) })
    return true
  }

  // DELETE /api/sessions/:hash
  const deleteMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})$/)
  if (deleteMatch && req.method === "DELETE") {
    const hash = deleteMatch[1]
    try {
      await terminateSession(hash, email)
    } catch (err) {
      const code = errorCode(err)
      if (code === "Forbidden") {
        json(res, 403, { error: "Forbidden" })
        return true
      }
      if (code === "NotFound") {
        json(res, 404, { error: "Not found" })
        return true
      }
      throw err
    }
    json(res, 204, null)
    return true
  }

  return false
}
