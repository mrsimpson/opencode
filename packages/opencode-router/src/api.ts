import http from "node:http"
import { ensurePVC, ensurePod, getPodState } from "./pod-manager.js"

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf-8")
}

/**
 * Handle API routes. Returns true if the route was handled.
 */
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  email: string,
): Promise<boolean> {
  const url = req.url ?? "/"

  if (url === "/api/status" && req.method === "GET") {
    const state = await getPodState(email)
    json(res, 200, { email, state })
    return true
  }

  if (url === "/api/sessions" && req.method === "POST") {
    const raw = await readBody(req)
    let repoUrl: string
    try {
      const body = JSON.parse(raw)
      repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : ""
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" })
      return true
    }

    if (!repoUrl) {
      json(res, 400, { ok: false, error: "repoUrl is required" })
      return true
    }

    await ensurePVC(email)
    await ensurePod(email, repoUrl)
    json(res, 201, { ok: true })
    return true
  }

  return false
}
