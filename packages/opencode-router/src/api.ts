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
  getSessionInfo,
  getSessionProgress,
  listUserSessions,
  prepullImage,
  remoteBranchExists,
  terminateSession,
  resumeSession,
  suggestBranch,
} from "./pod-manager.js"
import { podSecretStore } from "./pod-secret-store.js"
import { messageStore } from "./message-store.js"
import { createBroadcaster } from "./stream-broadcaster.js"
import type { ProgressPushEvent, StoredMessage } from "./progress-types.js"

// Module-level broadcaster singletons
const sessionsChangedBroadcaster = createBroadcaster<void>()
const progressBroadcaster = createBroadcaster<{ hash: string; message: StoredMessage }>()

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

  // GET /api/sessions/stream — SSE, emits full sessions snapshot when any session changes
  if (url === "/api/sessions/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    const sendSnapshot = async () => {
      const sessions = await listUserSessions(email, req)
      res.write(`event: sessions\ndata: ${JSON.stringify({ email, sessions })}\n\n`)
    }
    await sendSnapshot()
    let closed = false
    res.on("close", () => {
      closed = true
    })
    const unsubscribe = sessionsChangedBroadcaster.subscribe(async () => {
      if (closed) {
        unsubscribe()
        return
      }
      await sendSnapshot()
    })
    res.on("close", () => unsubscribe())
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
    const query = new URLSearchParams(url.split("?")[1] ?? "")
    const repoUrl = query.get("repoUrl")
    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" })
      return true
    }
    const branch = await suggestBranch(email, repoUrl)
    json(res, 200, { branch })
    return true
  }

  // GET /api/sessions/:hash/progress/stream — SSE, emits message thread for a session
  const progressStreamMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/progress\/stream$/)
  if (progressStreamMatch && req.method === "GET") {
    const hash = progressStreamMatch[1]
    // Ownership check
    const userSessions = await listUserSessions(email, req)
    if (!userSessions.find((s) => s.hash === hash)) {
      json(res, 403, { error: "Forbidden" })
      return true
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    const progress = messageStore.get(hash) ?? { messages: [] }
    res.write(`event: snapshot\ndata: ${JSON.stringify(progress)}\n\n`)
    let closed = false
    res.on("close", () => {
      closed = true
    })
    const unsubscribe = progressBroadcaster.subscribe(({ hash: h, message }) => {
      if (closed || h !== hash) return
      res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
    })
    res.on("close", () => unsubscribe())
    return true
  }

  // GET /api/sessions/:hash/events — SSE endpoint for session startup progress
  //
  // Streams session startup state as Server-Sent Events. Events emitted:
  //   progress     { stage, message }  — human-readable startup stage update
  //   state_change { state }           — when pod state transitions (creating → running)
  //   complete     { url }             — session ready; frontend should navigate to url
  //   error        { message }         — unrecoverable error; connection closes after
  //
  // Connection closes automatically after `complete` or `error`.
  // Client disconnect is handled via res.on("close").
  const eventsMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/events$/)
  if (eventsMatch && req.method === "GET") {
    const hash = eventsMatch[1]

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })

    /** Write a named SSE event with JSON data. */
    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // Check session exists before starting the poll loop
    const initial = await getSessionInfo(hash)
    if (!initial) {
      sendEvent("error", { message: "session not found" })
      res.end()
      return true
    }

    let closed = false
    res.on("close", () => {
      closed = true
    })

    let lastState = initial.state
    let lastStage = ""

    // Send initial progress immediately
    const progress = await getSessionProgress(hash)
    lastStage = progress.stage
    sendEvent("progress", progress)
    if (lastState !== "creating") {
      sendEvent("state_change", { state: lastState })
    }

    // If already running on first check, resolve immediately
    if (initial.state === "running") {
      sendEvent("progress", { stage: "readying", message: "Finalizing session..." })
      sendEvent("complete", { url: initial.url })
      res.end()
      return true
    }

    // Poll every 1000ms for state/progress changes
    const timer = setInterval(async () => {
      if (closed) {
        clearInterval(timer)
        return
      }
      try {
        const info = await getSessionInfo(hash)
        if (!info) {
          clearInterval(timer)
          sendEvent("error", { message: "session not found" })
          res.end()
          return
        }

        // Emit state_change if state transitioned
        if (info.state !== lastState) {
          lastState = info.state
          sendEvent("state_change", { state: info.state })
        }

        // Emit progress if stage changed (only while still creating)
        if (info.state === "creating") {
          const prog = await getSessionProgress(hash)
          if (prog.stage !== lastStage) {
            lastStage = prog.stage
            sendEvent("progress", prog)
          }
          return
        }

        // Session is running — emit readying progress then complete with URL
        if (info.state === "running") {
          if (lastStage !== "readying") {
            lastStage = "readying"
            sendEvent("progress", { stage: "readying", message: "Finalizing session..." })
          }
          clearInterval(timer)
          sendEvent("complete", { url: info.url })
          res.end()
        }
      } catch {
        // Transient error — retry on next tick
      }
    }, 1000)

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

  // GET /api/user/repos — list repositories for authenticated user via GitHub API
  if (url === "/api/user/repos" && req.method === "GET") {
    if (!githubToken) {
      json(res, 401, { error: "GitHub token required" })
      return true
    }
    try {
      const reposRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "opencode-router",
        },
      })
      if (!reposRes.ok) {
        const err = await reposRes.text()
        json(res, reposRes.status, { error: err })
        return true
      }
      const repos = (await reposRes.json()) as {
        name: string
        full_name: string
        html_url: string
        private: boolean
        default_branch: string
      }[]
      json(
        res,
        200,
        repos.map((r) => ({
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          isPrivate: r.private,
          defaultBranch: r.default_branch,
        })),
      )
    } catch (err) {
      console.error("listUserRepos failed:", err)
      json(res, 500, { error: "Failed to list repos" })
    }
    return true
  }

  // GET /api/user/repos/branches — list branches for a specific repo
  if (url.startsWith("/api/user/repos/branches") && req.method === "GET") {
    if (!githubToken) {
      json(res, 401, { error: "GitHub token required" })
      return true
    }
    const query = new URLSearchParams(url.split("?")[1] ?? "")
    const repo = query.get("repo")
    if (!repo) {
      json(res, 400, { error: "repo parameter required" })
      return true
    }
    try {
      const branchesRes = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "opencode-router",
        },
      })
      if (!branchesRes.ok) {
        const err = await branchesRes.text()
        json(res, branchesRes.status, { error: err })
        return true
      }
      const branches = (await branchesRes.json()) as { name: string }[]
      json(
        res,
        200,
        branches.map((b) => ({ name: b.name })),
      )
    } catch (err) {
      console.error("listRepoBranches failed:", err)
      json(res, 500, { error: "Failed to list branches" })
    }
    return true
  }

  // POST /api/admin/pull-image — pre-pull container image (CI endpoint)
  if (url === "/api/admin/pull-image" && req.method === "POST") {
    // Check if admin endpoint is configured
    if (!config.adminSecret) {
      json(res, 501, { error: "Admin endpoint not configured" })
      return true
    }

    // Verify admin secret
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret !== config.adminSecret) {
      json(res, 403, { error: "Forbidden" })
      return true
    }

    const raw = await readBody(req)
    let image: string
    let updateConfig = false
    try {
      const body = JSON.parse(raw)
      image = typeof body.image === "string" ? body.image.trim() : ""
      updateConfig = typeof body.updateConfig === "boolean" ? body.updateConfig : false
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }

    if (!image) {
      json(res, 400, { error: "image is required" })
      return true
    }

    try {
      const success = await prepullImage(image)

      if (success && updateConfig) {
        // Note: This only updates in-memory config for this process.
        // For persistence across restarts, update the deployment env var.
        ;(config as Record<string, unknown>).opencodeImage = image
      }

      if (success) {
        json(res, 200, {
          status: "success",
          message: `Image ${image} pre-pulled and verified successfully`,
        })
      } else {
        json(res, 500, {
          status: "failed",
          message: `Failed to pull and verify image ${image}`,
        })
      }
    } catch (err) {
      console.error("prepullImage failed:", err)
      json(res, 500, { error: "Internal server error" })
    }

    return true
  }

  // POST /api/sessions/:hash/progress — pod plugin pushes session data
  const progressPushMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/progress$/)
  if (progressPushMatch && req.method === "POST") {
    const hash = progressPushMatch[1]
    const podSecret = req.headers["x-pod-secret"]
    if (typeof podSecret !== "string" || !podSecretStore.verify(hash, podSecret)) {
      json(res, 401, { error: "Unauthorized" })
      return true
    }
    const raw = await readBody(req)
    let event: ProgressPushEvent
    try {
      event = JSON.parse(raw)
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }
    if (event.type === "session.title") {
      messageStore.setTitle(hash, event.title)
      sessionsChangedBroadcaster.emit()
    } else if (event.type === "message.user") {
      messageStore.addMessage(hash, {
        partID: event.partID,
        messageID: event.messageID,
        sessionID: event.sessionID,
        role: "user",
        text: event.text,
        time: event.time,
      })
      sessionsChangedBroadcaster.emit()
      progressBroadcaster.emit({
        hash,
        message: {
          partID: event.partID,
          messageID: event.messageID,
          sessionID: event.sessionID,
          role: "user",
          text: event.text,
          time: event.time,
        },
      })
    } else if (event.type === "message.assistant") {
      messageStore.addMessage(hash, {
        partID: event.partID,
        messageID: event.messageID,
        sessionID: event.sessionID,
        role: "assistant",
        text: event.text,
        time: event.time,
      })
      sessionsChangedBroadcaster.emit()
      progressBroadcaster.emit({
        hash,
        message: {
          partID: event.partID,
          messageID: event.messageID,
          sessionID: event.sessionID,
          role: "assistant",
          text: event.text,
          time: event.time,
        },
      })
    } else {
      json(res, 400, { error: "Unknown event type" })
      return true
    }
    json(res, 200, { ok: true })
    return true
  }

  return false
}
