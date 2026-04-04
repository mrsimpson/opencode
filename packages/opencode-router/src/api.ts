import type http from "node:http";
import { config } from "./config.js";
import {
  type SessionKey,
  ensurePVC,
  ensurePod,
  getPodState,
  getSessionHash,
  listUserSessions,
} from "./pod-manager.js";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Build the public URL for a session subdomain. */
function sessionUrl(hash: string, req: http.IncomingMessage): string {
  // Derive scheme from X-Forwarded-Proto (set by Traefik) or default to http in dev
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  return `${proto}://${hash}.${config.routerDomain}`;
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
  email: string
): Promise<boolean> {
  const url = req.url ?? "/";

  // GET /api/sessions — list all sessions for this user, always includes email
  if (url === "/api/sessions" && req.method === "GET") {
    const sessions = await listUserSessions(email, req);
    json(res, 200, { email, sessions });
    return true;
  }

  // POST /api/sessions — create a new session
  if (url === "/api/sessions" && req.method === "POST") {
    const raw = await readBody(req);
    let repoUrl: string;
    let branch: string;
    try {
      const body = JSON.parse(raw);
      repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
      branch = typeof body.branch === "string" ? body.branch.trim() : "";
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return true;
    }

    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" });
      return true;
    }
    if (!branch) {
      json(res, 400, { error: "branch is required" });
      return true;
    }

    const session: SessionKey = { email, repoUrl, branch };
    const hash = getSessionHash(email, repoUrl, branch);

    await ensurePVC(session);
    await ensurePod(session);

    json(res, 201, { hash, url: sessionUrl(hash, req), state: "creating" });
    return true;
  }

  // GET /api/sessions/:hash — get state of a specific session
  const sessionMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})$/);
  if (sessionMatch && req.method === "GET") {
    const hash = sessionMatch[1];
    const state = await getPodState(hash);
    json(res, 200, { hash, state, url: sessionUrl(hash, req) });
    return true;
  }

  return false;
}
