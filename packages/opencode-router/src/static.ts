import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/**
 * Serve static files from the given directory with SPA fallback to index.html.
 */
export function serveStatic(
  publicDir: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const url = new URL(req.url ?? "/", "http://localhost")
  let filePath = path.join(publicDir, url.pathname)

  // Prevent directory traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden")
    return
  }

  // Try the exact path, then fall back to index.html for SPA routing
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(publicDir, "index.html")
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end("Not Found")
    return
  }

  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
  const content = fs.readFileSync(filePath)
  res.writeHead(200, { "Content-Type": contentType }).end(content)
}
