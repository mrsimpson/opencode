const POLL_INTERVAL_MS = 5_000
const MIN_PORT = 3000
const OPENCODE_PORT = 4096
const PROC_NET_TCP = "/proc/net/tcp"

/**
 * Parse /proc/net/tcp and return qualifying listening port numbers.
 * Filters: port > MIN_PORT (3000), != OPENCODE_PORT (4096), <= 65535.
 */
export function parseProcNetTcp(content: string): number[] {
  const ports = new Set<number>()
  for (const line of content.split("\n").slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Format: sl local_address rem_address st ...
    // local_address is "XXXXXXXX:XXXX" (little-endian IP:port hex)
    const hexPort = trimmed.split(/\s+/)[1]?.split(":")[1]
    if (!hexPort) continue
    const port = parseInt(hexPort, 16)
    if (port > MIN_PORT && port !== OPENCODE_PORT && port <= 65535) {
      ports.add(port)
    }
  }
  return Array.from(ports).sort((a, b) => a - b)
}

/**
 * Start a background loop that:
 * 1. Reads /proc/net/tcp every POLL_INTERVAL_MS
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
      const content = await Bun.file(PROC_NET_TCP).text()
      const ports = parseProcNetTcp(content)
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
