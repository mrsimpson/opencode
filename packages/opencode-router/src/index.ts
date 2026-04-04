import http from "node:http";
import httpProxy from "http-proxy";
import { handleApi } from "./api.js";
import { config } from "./config.js";
import { deleteIdlePods, getPodIP, updateLastActivity } from "./pod-manager.js";
import { serveStatic } from "./static.js";

const SESSION_PATH_RE = /^\/code\/([a-f0-9]{12})(\/.*)?$/;
const SESSION_COOKIE = "oc-session";

function getEmail(req: http.IncomingMessage): string | null {
  const header = req.headers["x-auth-request-email"];
  if (typeof header === "string" && header.length > 0) return header;
  // Dev fallback: use DEV_EMAIL env var when running locally without oauth2-proxy
  if (config.devEmail) return config.devEmail;
  return null;
}

/** Extract session hash from the oc-session cookie, if present. */
function getSessionCookie(req: http.IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=").trim();
  }
  return null;
}

const proxy = httpProxy.createProxyServer({});

proxy.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message);
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502).end("Bad Gateway");
  }
});

async function proxyToSession(
  hash: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const ip = await getPodIP(hash);
  if (!ip) return false;
  updateLastActivity(hash);
  const target = config.devPodProxyTarget ?? `http://${ip}:${config.opencodePort}`;
  proxy.web(req, res, { target });
  return true;
}

const server = http.createServer(async (req, res) => {
  const email = getEmail(req);
  if (!email) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Missing user identity");
    return;
  }

  try {
    const url = req.url ?? "/";

    // Router's own API — handled before any session routing
    if (url.startsWith("/api/")) {
      const handled = await handleApi(req, res, email);
      if (handled) return;
    }

    // /code/:hash[/*] — set session cookie and proxy to the session's pod
    const sessionMatch = url.match(SESSION_PATH_RE);
    if (sessionMatch) {
      const hash = sessionMatch[1];
      const ip = await getPodIP(hash);
      if (!ip) {
        res
          .writeHead(503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "session not ready", hash }));
        return;
      }
      updateLastActivity(hash);
      // Set cookie so subsequent absolute-path requests from the SPA are routed to this pod
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${hash}; Path=/; SameSite=Strict`);
      const target = config.devPodProxyTarget ?? `http://${ip}:${config.opencodePort}`;
      // Strip /code/:hash prefix — opencode expects to be rooted at /
      req.url = sessionMatch[2] ?? "/";
      proxy.web(req, res, { target });
      return;
    }

    // Not a /code/:hash path — check if this request belongs to an active session via cookie.
    // This handles absolute-path requests made by the opencode SPA (e.g. /session, /provider).
    const sessionHash = getSessionCookie(req);
    if (sessionHash) {
      const proxied = await proxyToSession(sessionHash, req, res);
      if (proxied) return;
      // Cookie points to a pod that's no longer running — fall through to SPA
    }

    // No active session — serve the setup SPA (or proxy to Vite in dev)
    if (config.devViteUrl) {
      proxy.web(req, res, { target: config.devViteUrl });
    } else {
      serveStatic(config.publicDir, req, res);
    }
  } catch (err) {
    console.error(`Error handling request for ${email}:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal server error");
    }
  }
});

server.on("upgrade", async (req, socket, head) => {
  const email = getEmail(req);
  if (!email) {
    socket.destroy();
    return;
  }

  try {
    const url = req.url ?? "/";

    // WebSocket for a session pod via /code/:hash path
    const sessionMatch = url.match(SESSION_PATH_RE);
    if (sessionMatch) {
      const hash = sessionMatch[1];
      const ip = await getPodIP(hash);
      if (!ip) {
        socket.destroy();
        return;
      }
      updateLastActivity(hash);
      req.url = sessionMatch[2] ?? "/";
      const target = config.devPodProxyTarget ?? `http://${ip}:${config.opencodePort}`;
      proxy.ws(req, socket, head, { target });
      return;
    }

    // WebSocket from opencode SPA (absolute path) — route via session cookie
    const sessionHash = getSessionCookie(req);
    if (sessionHash) {
      const ip = await getPodIP(sessionHash);
      if (ip) {
        updateLastActivity(sessionHash);
        const target = config.devPodProxyTarget ?? `http://${ip}:${config.opencodePort}`;
        proxy.ws(req, socket, head, { target });
        return;
      }
    }

    // WebSocket for Vite HMR (SPA dev mode, no session cookie)
    if (config.devViteUrl) {
      proxy.ws(req, socket, head, { target: config.devViteUrl });
      return;
    }

    socket.destroy();
  } catch (err) {
    console.error(`WebSocket upgrade error for ${email}:`, err);
    socket.destroy();
  }
});

// Background: clean up idle pods every 60 seconds
const cleanupInterval = setInterval(deleteIdlePods, 60_000);

// Graceful shutdown
function shutdown() {
  console.log("Shutting down...");
  clearInterval(cleanupInterval);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(config.port, () => {
  console.log(`opencode-router listening on :${config.port}`);
});
