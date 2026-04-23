import http from "node:http"
import httpProxy from "http-proxy"
import { handleApi } from "./api.js"
import { config } from "./config.js"
import * as devProxy from "./dev-proxy.js"
import { deleteIdlePods, getPodIP, updateLastActivity } from "./pod-manager.js"
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
  const email = getEmail(req)
  if (!email) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Missing user identity")
    return
  }

  try {
    const host = req.headers.host ?? ""
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
      proxy.web(req, res, { target })
      return
    }

    // ── Root domain: opencode-router.domain ───────────────────────────────
    // Router's own API
    const url = req.url ?? "/"
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
      proxy.ws(req, socket, head, { target })
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

// Background: clean up idle pods every 60 seconds
const cleanupInterval = setInterval(deleteIdlePods, 60_000)

function shutdown() {
  console.log("Shutting down...")
  clearInterval(cleanupInterval)
  devProxy.cleanup()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(config.port, () => {
  console.log(`opencode-router listening on :${config.port} | domain: ${config.routerDomain}`)
})
