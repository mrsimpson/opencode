const POLL_INTERVAL_MS = 5_000
const OPENCODE_PORT = 4096
const PROC_NET_TCP = "/proc/net/tcp"
const PROC_NET_TCP6 = "/proc/net/tcp6"

/**
 * Allowlist of ports that are automatically exposed as public subdomains.
 * Overridable via DEV_PORT_ALLOWLIST env var (comma-separated integers).
 * Covers: Vite (5173/5174), CRA/Next (3000/3001), HTTP dev (8000/8080/8888), Astro (4321).
 */
const DEV_PORT_ALLOWLIST: ReadonlySet<number> = new Set(
  (process.env.DEV_PORT_ALLOWLIST ?? "3000,3001,4321,5173,5174,8000,8080,8888")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => p > 0 && p <= 65535 && p !== OPENCODE_PORT),
)

/**
 * Parse /proc/net/tcp or /proc/net/tcp6 and return listening port numbers that
 * are in the DEV_PORT_ALLOWLIST.
 * Both files use "address:PORT" in the local_address column — the port is always
 * the last colon-separated segment (IPv4: "XXXXXXXX:PPPP", IPv6: "XXXX...XXXX:PPPP").
 * State 0A = TCP_LISTEN — only listening sockets are reported.
 */
export function parseProcNetTcp(content: string): number[] {
  const ports = new Set<number>()
  for (const line of content.split("\n").slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const fields = trimmed.split(/\s+/)
    // state is the 4th field (index 3); 0A = TCP_LISTEN
    if (fields[3] !== "0A") continue
    // local_address is the 2nd field; port is after the last ":"
    const hexPort = fields[1]?.split(":").at(-1)
    if (!hexPort) continue
    const port = parseInt(hexPort, 16)
    if (DEV_PORT_ALLOWLIST.has(port)) ports.add(port)
  }
  return Array.from(ports).sort((a, b) => a - b)
}

/**
 * Start a background loop that:
 * 1. Reads /proc/net/tcp and /proc/net/tcp6 every POLL_INTERVAL_MS
 * 2. Compares against last pushed port set
 * 3. POSTs new set to router when it changes
 *
 * No-op when:
 * - Running on non-Linux (can't read /proc/net/tcp)
 * - Any required env var is missing
 *
 * Returns a cleanup function that stops the watcher.
 */
export function startPortWatcher(): () => void {
  const routerUrl = process.env.OPENCODE_ROUTER_URL
  const hash = process.env.OPENCODE_SESSION_HASH
  const secret = process.env.OPENCODE_POD_SECRET

  if (!routerUrl || !hash || !secret) {
    return () => {}
  }

  if (process.platform !== "linux") {
    return () => {}
  }

  let stopped = false
  let lastPushed: string | null = null

  const poll = async () => {
    if (stopped) return
    try {
      const [tcp4, tcp6] = await Promise.all([
        Bun.file(PROC_NET_TCP).text(),
        Bun.file(PROC_NET_TCP6).text().catch(() => ""),
      ])
      const ports = [...new Set([...parseProcNetTcp(tcp4), ...parseProcNetTcp(tcp6)])].sort((a, b) => a - b)
      const key = ports.join(",")
      if (key !== lastPushed) {
        try {
          const res = await fetch(`${routerUrl}/api/sessions/${hash}/ports`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-pod-secret": secret,
            },
            body: JSON.stringify({ ports }),
          })
          if (!res.ok) {
            console.warn(`opencode-router-plugin: pushPorts → HTTP ${res.status}`)
          } else {
            lastPushed = key
          }
        } catch (err) {
          console.warn("opencode-router-plugin: pushPorts failed:", err)
        }
      }
    } catch {
      // /proc/net/tcp unreadable — non-fatal, retry next cycle
    }
    if (!stopped) setTimeout(() => void poll(), POLL_INTERVAL_MS)
  }

  const timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
