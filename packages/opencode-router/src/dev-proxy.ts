import { spawn, type ChildProcess } from "node:child_process"
import net from "node:net"
import { config } from "./config.js"

/**
 * Dev-mode helper: manages kubectl port-forward processes per session.
 * In production (in-cluster), pod IPs are directly routable.
 * Locally, we need kubectl port-forward to bridge the gap.
 */

interface Forward {
  port: number
  proc: ChildProcess
  ready: Promise<number>
}

const forwards = new Map<string, Forward>()

/** True when running outside the cluster (dev mode). */
export const enabled = !!(config.devEmail || config.devViteUrl || config.devPodProxyTarget)

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("failed to get port")))
        return
      }
      const port = addr.port
      srv.close(() => resolve(port))
    })
    srv.on("error", reject)
  })
}

/**
 * Get a local proxy target URL for a session pod.
 * Spawns kubectl port-forward on first call per hash; reuses on subsequent calls.
 * Returns `http://localhost:<port>` or null if the forward fails.
 */
export async function target(hash: string): Promise<string | null> {
  // Single fixed target overrides everything
  if (config.devPodProxyTarget) return config.devPodProxyTarget

  const existing = forwards.get(hash)
  if (existing) {
    try {
      const port = await existing.ready
      return `http://localhost:${port}`
    } catch {
      // Previous forward failed; clean up and retry below
      forwards.delete(hash)
    }
  }

  const port = await freePort()
  const pod = `opencode-session-${hash}`

  // Use the system default kubeconfig (not the SA kubeconfig from KUBECONFIG env var)
  // so the port-forward runs with admin credentials, not the restricted service account.
  const env = { ...process.env }
  delete env.KUBECONFIG

  const proc = spawn(
    "kubectl",
    ["port-forward", `pod/${pod}`, `${port}:${config.opencodePort}`, "-n", config.namespace],
    { stdio: ["ignore", "pipe", "pipe"], env },
  )

  const ready = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("port-forward timeout")), 10_000)
    let stderr = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString()
      // kubectl prints "Forwarding from 127.0.0.1:<port> -> <port>" when ready
      if (line.includes("Forwarding from")) {
        clearTimeout(timeout)
        resolve(port)
      }
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on("exit", (code) => {
      clearTimeout(timeout)
      forwards.delete(hash)
      if (code !== 0) reject(new Error(`port-forward exited ${code}: ${stderr}`))
    })
  })

  const fwd: Forward = { port, proc, ready }
  forwards.set(hash, fwd)

  try {
    const resolved = await ready
    return `http://localhost:${resolved}`
  } catch (err) {
    console.error(`[dev-proxy] port-forward failed for ${hash}:`, err)
    forwards.delete(hash)
    return null
  }
}

/** Kill all port-forward processes (called on shutdown). */
export function cleanup(): void {
  for (const [, fwd] of forwards) {
    fwd.proc.kill()
  }
  forwards.clear()
}
