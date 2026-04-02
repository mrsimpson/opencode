import http from "node:http"
import httpProxy from "http-proxy"
import { config } from "./config.js"
import { getPodIP, updateLastActivity, deleteIdlePods } from "./pod-manager.js"
import { handleApi } from "./api.js"
import { serveStatic } from "./static.js"

function getEmail(req: http.IncomingMessage): string | null {
  const header = req.headers["x-auth-request-email"]
  if (typeof header === "string" && header.length > 0) return header
  return null
}

const proxy = httpProxy.createProxyServer({})

proxy.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message)
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502).end("Bad Gateway")
  }
})

const server = http.createServer(async (req, res) => {
  const email = getEmail(req)
  if (!email) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Missing user identity")
    return
  }

  try {
    // API routes are handled regardless of pod state
    const url = req.url ?? "/"
    if (url.startsWith("/api/")) {
      const handled = await handleApi(req, res, email)
      if (handled) return
    }

    // If pod is running, proxy to it
    const ip = await getPodIP(email)
    if (ip) {
      updateLastActivity(email)
      proxy.web(req, res, { target: `http://${ip}:${config.opencodePort}` })
      return
    }

    // No running pod — serve the setup UI
    serveStatic(config.publicDir, req, res)
  } catch (err) {
    console.error(`Error handling request for ${email}:`, err)
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
    const ip = await getPodIP(email)
    if (!ip) {
      socket.destroy()
      return
    }
    updateLastActivity(email)
    proxy.ws(req, socket, head, { target: `http://${ip}:${config.opencodePort}` })
  } catch (err) {
    console.error(`WebSocket upgrade error for ${email}:`, err)
    socket.destroy()
  }
})

// Background: clean up idle pods every 60 seconds
const cleanupInterval = setInterval(deleteIdlePods, 60_000)

// Graceful shutdown
function shutdown() {
  console.log("Shutting down...")
  clearInterval(cleanupInterval)
  server.close(() => process.exit(0))
  // Force exit after 10s if connections don't drain
  setTimeout(() => process.exit(1), 10_000)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(config.port, () => {
  console.log(`opencode-router listening on :${config.port}`)
})
