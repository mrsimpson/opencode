import http from "node:http"
import httpProxy from "http-proxy"
import { config } from "./config.js"
import { ensurePVC, ensurePod, getPodIP, updateLastActivity, deleteIdlePods } from "./pod-manager.js"

const LOADING_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenCode</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;background:#1a1a2e;color:#e0e0e0">
  <div style="text-align:center">
    <h2>Starting your OpenCode session&hellip;</h2>
    <p style="color:#888">This usually takes a few seconds.</p>
  </div>
  <script>setTimeout(()=>location.reload(),3000)</script>
</body>
</html>`

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
    const ip = await getPodIP(email)
    if (ip) {
      updateLastActivity(email)
      proxy.web(req, res, { target: `http://${ip}:${config.opencodePort}` })
      return
    }

    // Pod doesn't exist or isn't ready — provision and show loading page
    await ensurePVC(email)
    await ensurePod(email)
    res.writeHead(202, { "Content-Type": "text/html" }).end(LOADING_HTML)
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
