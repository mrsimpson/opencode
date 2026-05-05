---
name: dev-server
description: How to start a development server in the background and construct the public URL for port-forwarding in this homelab environment
---

# Starting a Development Server

This environment runs inside a Kubernetes pod. Dev servers must be started **detached** (in the background) so the agent process can continue. Once a port is listening, the infrastructure automatically creates a public URL for it.

## Starting a Dev Server (detached)

Always start dev servers in the background with output redirected so they don't block the agent:

```bash
# Generic pattern
nohup <start-command> > /tmp/dev-server.log 2>&1 &
echo "Dev server PID: $!"

# Vite (React, Vue, Svelte, etc.)
nohup npm run dev > /tmp/dev-server.log 2>&1 &

# Next.js
nohup npm run dev > /tmp/next-dev.log 2>&1 &

# Node.js / Express
nohup node server.js > /tmp/server.log 2>&1 &

# Bun
nohup bun run dev > /tmp/dev-server.log 2>&1 &
```

Wait a few seconds for the server to start before trying to access it:

```bash
sleep 3
# Verify it's listening
ss -tlnp | grep <port>
# or check logs
tail /tmp/dev-server.log
```

## Supported Ports (auto-exposed)

Only ports in the following allowlist are automatically exposed as public URLs:

| Port | Common Use |
|------|-----------|
| 3000 | Next.js, Express, React (CRA) |
| 3001 | Alternative dev port |
| 4321 | Astro |
| 5173 | Vite (default) |
| 5174 | Vite (alternative) |
| 8000 | Python http.server, Django, generic HTTP |
| 8080 | Generic HTTP, Webpack DevServer |
| 8888 | Jupyter Notebook |

> If your framework defaults to a different port, configure it to use one of the ports above (e.g. `vite --port 5173`, `next dev --port 3000`).

## Constructing the Public URL

Once the server is listening, the public URL follows this pattern:

```
https://<port>-<session-hash>-oc.<domain>
```

### Get the session hash

The session hash is available as an environment variable:

```bash
echo $OPENCODE_SESSION_HASH
```

### Get the domain

The domain is the base domain of the current session's URL. Your session is accessible at:
```
https://<session-hash>-oc.<domain>
```

To extract the domain from your current session hostname:

```bash
# The current session hostname looks like: abc123def456-oc.no-panic.org
# Strip the "<hash>-oc." prefix to get the base domain
CURRENT_HOST=$(hostname -f 2>/dev/null || cat /etc/hostname)
# Or ask the user / check the URL in the browser address bar
```

Typically the domain is something like `no-panic.org` or similar. When in doubt, ask the user to confirm the base domain.

### Full URL construction

```bash
PORT=5173   # replace with your actual port
DOMAIN=no-panic.org  # replace with actual domain from session URL
echo "https://${PORT}-${OPENCODE_SESSION_HASH}-oc.${DOMAIN}"
```

### Example

If `OPENCODE_SESSION_HASH=abc123def456` and the domain is `no-panic.org`, a Vite server on port 5173 is accessible at:

```
https://5173-abc123def456-oc.no-panic.org
```

## Environment Variables in the Pod

| Variable | Description |
|----------|-------------|
| `OPENCODE_SESSION_HASH` | 12-character hex hash identifying this session |
| `OPENCODE_ROUTER_URL` | Internal cluster URL of the router (not the public domain) |

> The public domain is **not** directly available as an env var in the pod. Derive it from the session URL shown in the browser, or ask the user.

## Tips

- **Always use `nohup … &`** — not just `… &`. Without `nohup`, the process dies when the terminal session ends.
- **Redirect both stdout and stderr** (`> file 2>&1`) to avoid blocking on output.
- **Check the log** after starting to confirm the server bound successfully before sharing the URL.
- **Ports below 3000 and port 4096** are not forwarded (4096 is reserved for the OpenCode server itself).
- **The bind-all-interfaces patch is active**: Node.js `server.listen('localhost')` is automatically rewritten to `0.0.0.0` — dev servers will be reachable from outside the pod without any extra flags.
