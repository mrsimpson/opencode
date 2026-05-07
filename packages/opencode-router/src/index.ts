import http from "node:http"
import httpProxy from "http-proxy"
import { handleApi } from "./api.js"
import { config } from "./config.js"
import * as devProxy from "./dev-proxy.js"
import {
  deleteIdlePods,
  getPodIP,
  updateLastActivity,
  restorePodSecrets,
  getOrCreateAttachPassword,
} from "./pod-manager.js"
import { serveStatic } from "./static.js"

/**
 * Extract session hash and optional port from the Host header.
 * Returns {hash, port} where port is either a number >3000 (for dev servers) or null (defaults to config.opencodePort).
 *
 * Session hostname format:
 *   <hash>-oc.<domain>         → hash only (defaults to port 4096)
 *   <port>-<hash>-oc.<domain>  → explicit dev server port (e.g., 5173-abc123... → port 5173)
 *
 * With ROUTE_SUFFIX="" (local dev, ROUTER_DOMAIN="localhost:3002"):
 *   abc123-oc.localhost:3002       → hash, port 4096
 *   5173-abc123-oc.localhost:3002 → hash, port 5173
 */
function getSessionInfo(host: string): { hash: string | null; port: number | null } {
  // Strip port from both the incoming Host header and routerDomain before comparing
  const hostname = host.split(":")[0]
  const routerHostname = config.routerDomain.split(":")[0]
  const suffix = `${config.routeSuffix}.${routerHostname}`
  if (!hostname.endsWith(suffix)) return { hash: null, port: null }

  const sub = hostname.slice(0, hostname.length - suffix.length)

  // Check for <port>-<hash> pattern (port is 4+ digits at start)
  const portMatch = sub.match(/^([1-9][0-9]{3,})-(.+)$/)
  if (portMatch) {
    const port = parseInt(portMatch[1], 10)
    const hashPart = portMatch[2]
    if (/^[a-f0-9]{12}$/.test(hashPart)) {
      return { hash: hashPart, port }
    }
  }

  // Default: just <hash>
  if (/^[a-f0-9]{12}$/.test(sub)) {
    return { hash: sub, port: null }
  }

  return { hash: null, port: null }
}

/**
 * Extract attach session hash from the Host header.
 * Returns the hash if the request is on an attach subdomain, or null otherwise.
 *
 * Attach hostname format: <attachRoutePrefix><hash><routeSuffix>.<routerDomain>
 * e.g. with attachRoutePrefix="attach-", routeSuffix="-oc", routerDomain="no-panic.org":
 *   attach-abc123def456-oc.no-panic.org → "abc123def456"
 */
function getAttachSessionHash(host: string): string | null {
  const hostname = host.split(":")[0]
  const routerHostname = config.routerDomain.split(":")[0]
  const suffix = `${config.routeSuffix}.${routerHostname}`
  const prefix = config.attachRoutePrefix

  // Check if hostname ends with suffix and starts with prefix
  if (!hostname.endsWith(suffix) || !hostname.startsWith(prefix)) return null

  const hashPart = hostname.slice(prefix.length, hostname.length - suffix.length)
  if (/^[a-f0-9]{12}$/.test(hashPart)) return hashPart
  return null
}

/**
 * Validate attach password from request.
 * Checks query parameter ?password= or header X-Attach-Password.
 * Compares against the stored password in PVC annotation.
 */
async function validateAttachPassword(hash: string, req: http.IncomingMessage): Promise<boolean> {
  // Get password from query param or header
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const providedPassword = url.searchParams.get("password") ?? req.headers["x-attach-password"]

  if (!providedPassword || typeof providedPassword !== "string") return false

  // Get stored password from PVC annotation
  try {
    const storedPassword = await getOrCreateAttachPassword(hash)
    return storedPassword === providedPassword
  } catch {
    return false
  }
}

function getEmail(req: http.IncomingMessage): string | null {
  const header = req.headers["x-auth-request-email"]
  if (typeof header === "string" && header.length > 0) return header
  // Dev fallback: use DEV_EMAIL env var when running locally without oauth2-proxy
  if (config.devEmail) return config.devEmail
  return null
}

function getGithubToken(req: http.IncomingMessage): string | undefined {
  const header =
    req.headers["x-auth-request-access-token"] ??
    req.headers["x-auth-request-token"] ??
    req.headers["x-forwarded-access-token"]
  return typeof header === "string" && header.length > 0 ? header : undefined
}

const proxy = httpProxy.createProxyServer({})

proxy.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message)
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502).end("Bad Gateway")
  }
})

const server = http.createServer(async (req, res) => {
  if (config.debugHeaders) {
    console.log(
      `[debug] ${req.method} ${req.headers.host}${req.url} email=${req.headers["x-auth-request-email"] ?? "MISSING"} token=${req.headers["x-auth-request-access-token"] ? "PRESENT" : "MISSING"}`,
    )
  }

  // ── Admin endpoints: check admin secret BEFORE email check ───────────────
  const url = req.url ?? "/"
  const isAdminEndpoint = url.startsWith("/api/admin/")
  if (isAdminEndpoint && req.method === "POST" && config.adminSecret) {
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret === config.adminSecret) {
      // Admin authenticated — skip email check
      const handled = await handleApi(req, res, "admin@localhost", undefined)
      if (handled) return
    }
  }

  // ── Pod pushes: POST /api/sessions/:hash/progress and /ports (x-pod-secret, no email) ─
  // Both endpoints are called by the in-pod plugin with x-pod-secret — they never
  // have an oauth2 email header.  Auth is enforced inside handleApi via podSecretStore.
  if (/^\/api\/sessions\/[a-f0-9]{12}\/(progress|ports)$/.test(url) && req.method === "POST") {
    const handled = await handleApi(req, res, "pod@localhost", undefined)
    if (handled) return
  }

  // ── Operator port poll: GET /api/sessions/:hash/ports requires admin secret ─
  const isPortsGet = /^\/api\/sessions\/[a-f0-9]{12}\/ports$/.test(url) && req.method === "GET"
  if (isPortsGet && config.adminSecret) {
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret !== config.adminSecret) {
      res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Forbidden" }))
      return
    }
    const handled = await handleApi(req, res, "admin@localhost", undefined)
    if (handled) return
  }

  const host = req.headers.host ?? ""
  const email = getEmail(req)
  if (!email) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Missing user identity")
    return
  }

  try {
    const { hash, port } = getSessionInfo(host)

    if (hash) {
      // ── Session subdomain: <hash>.opencode-router.domain ──────────────────
      // All traffic (HTTP + WS) is proxied directly to the session's pod.
      // No path stripping — opencode is rooted at /.
      const targetPort = port ?? config.opencodePort
      let target: string | null = null
      if (devProxy.enabled) {
        // Dev mode: pod IPs aren't routable; use kubectl port-forward
        target = await devProxy.target(hash)
      } else {
        const ip = await getPodIP(hash)
        if (ip) target = `http://${ip}:${targetPort}`
      }
      if (!target) {
        res
          .writeHead(503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "session not ready", hash }))
        return
      }
      updateLastActivity(hash)
      // changeOrigin rewrites the Host header to the pod IP/port so that dev
      // servers (Vite, Next.js, …) accept the request. Without it the original
      // public hostname (e.g. 5173-<hash>-oc.no-panic.org) is forwarded and
      // Vite 5's host-check returns 403. IP addresses always bypass the check.
      proxy.web(req, res, { target, changeOrigin: true })
      return
    }

    // ── Root domain: opencode-router.domain ───────────────────────────────
    // Router's own API
    if (url.startsWith("/api/")) {
      const handled = await handleApi(req, res, email, getGithubToken(req))
      if (handled) return
    }

    // Setup SPA (or Vite dev server)
    if (config.devViteUrl) {
      proxy.web(req, res, { target: config.devViteUrl })
    } else {
      serveStatic(config.publicDir, req, res)
    }
  } catch (err) {
    console.error(`Error handling request for ${req.headers.host}:`, err)
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal server error")
    }
  }
})

server.on("upgrade", async (req, socket, head) => {
  // ── Admin endpoints: no WebSocket support needed ────────────────
  const url = req.url ?? "/"
  if (url.startsWith("/api/admin/")) {
    socket.destroy()
    return
  }

  const email = getEmail(req)
  if (!email) {
    socket.destroy()
    return
  }

  try {
    const host = req.headers.host ?? ""
    const { hash, port } = getSessionInfo(host)

    if (hash) {
      // WebSocket on a session subdomain — proxy to the pod
      const targetPort = port ?? config.opencodePort
      let target: string | null = null
      if (devProxy.enabled) {
        target = await devProxy.target(hash)
      } else {
        const ip = await getPodIP(hash)
        if (ip) target = `http://${ip}:${targetPort}`
      }
      if (!target) {
        socket.destroy()
        return
      }
      updateLastActivity(hash)
      proxy.ws(req, socket, head, { target, changeOrigin: true })
      return
    }

    // WebSocket on root domain — Vite HMR in dev mode
    if (config.devViteUrl) {
      proxy.ws(req, socket, head, { target: config.devViteUrl })
      return
    }

    socket.destroy()
  } catch (err) {
    console.error(`WebSocket upgrade error for ${req.headers.host}:`, err)
    socket.destroy()
  }
})

// ── Attach server: listens on attachPort, NOT behind oauth2-proxy ─────────
// This port handles attach subdomain requests with password-based auth
// instead of OAuth, so local clients can connect directly.
const attachServer = http.createServer(async (req, res) => {
  const host = req.headers.host ?? ""
  const attachHash = getAttachSessionHash(host)
  if (attachHash) {
    const passwordValid = await validateAttachPassword(attachHash, req)
    if (!passwordValid) {
      res
        .writeHead(401, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Invalid or missing attach password" }))
      return
    }

    let target: string | null = null
    if (devProxy.enabled) {
      target = await devProxy.target(attachHash)
    } else {
      const ip = await getPodIP(attachHash)
      if (ip) target = `http://${ip}:${config.opencodePort}`
    }
    if (!target) {
      res
        .writeHead(503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "session not ready", hash: attachHash }))
      return
    }
    updateLastActivity(attachHash)
    proxy.web(req, res, { target, changeOrigin: true })
    return
  }

  res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }))
})

attachServer.on("upgrade", async (req, socket, head) => {
  const attachHash = getAttachSessionHash(req.headers.host ?? "")
  if (attachHash) {
    const passwordValid = await validateAttachPassword(attachHash, req)
    if (!passwordValid) {
      socket.destroy()
      return
    }

    let target: string | null = null
    if (devProxy.enabled) {
      target = await devProxy.target(attachHash)
    } else {
      const ip = await getPodIP(attachHash)
      if (ip) target = `http://${ip}:${config.opencodePort}`
    }
    if (!target) {
      socket.destroy()
      return
    }
    updateLastActivity(attachHash)
    proxy.ws(req, socket, head, { target, changeOrigin: true })
    return
  }

  socket.destroy()
})

// Background: clean up idle pods every 60 seconds
const cleanupInterval = setInterval(deleteIdlePods, 60_000)

function shutdown() {
  console.log("Shutting down...")
  clearInterval(cleanupInterval)
  devProxy.cleanup()
  server.close()
  attachServer.close()
  setTimeout(() => process.exit(0), 5_000)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(config.port, () => {
  console.log(`opencode-router listening on :${config.port} | domain: ${config.routerDomain}`)
  // Restore pod secrets from annotations so running pods can still push after a router restart
  restorePodSecrets().catch((err) => console.error("Failed to restore pod secrets:", err))
})

// Start attach server on the configured attach port (default 4096)
// This port should NOT be behind oauth2-proxy
if (config.attachPort !== config.port) {
  attachServer.listen(config.attachPort, () => {
    console.log(`opencode-router attach server listening on :${config.attachPort}`)
  })
} else {
  console.warn(
    `Attach port (${config.attachPort}) is same as main port (${config.port}). Attach server not started separately.`,
  )
}
