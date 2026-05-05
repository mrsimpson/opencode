import http from "node:http"
import * as k8s from "@kubernetes/client-node"
import { config, sessionHostname, sessionPortHostname } from "./config.js"
import { createDnsRecord, createTunnelRoute, deleteDnsRecord, deleteTunnelRoute, getTunnelCname, getTunnelRouteHostnames } from "./cloudflare.js"
import { createIngressRoutes, deleteIngressRoutes, listManagedIngressRoutes } from "./ingressroute.js"

/** Label selector for session PVCs (used to detect termination) */
const PVC_LABEL_SELECTOR = "app.kubernetes.io/managed-by=opencode-router"

/** Interval between port-polling cycles per active pod (ms) */
const PORT_POLL_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Kubernetes client
// ---------------------------------------------------------------------------

const kc = new k8s.KubeConfig()
import fs from "node:fs"
if (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}

// ---------------------------------------------------------------------------
// Per-pod port polling loop
// ---------------------------------------------------------------------------

/**
 * Track which ports we have already provisioned per session hash so we don't
 * re-create ingress entries on every poll cycle.
 */
const provisionedPorts = new Map<string, Set<number>>()

/**
 * Track active polling timers so we can cancel them when a pod is deleted.
 */
const podPollers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Create Traefik IngressRoutes for a single dev-server port on a session.
 * No per-port Cloudflare DNS/tunnel entries — the wildcard covers *.domain.
 */
async function provisionPortRoute(hash: string, port: number): Promise<void> {
  const portHostname = sessionPortHostname(hash, port)
  await createIngressRoutes(portHostname)
  console.log(`Provisioned ${portHostname} (port ${port})`)
}

/**
 * Fetch the current list of dev-server ports reported by a session pod from
 * the router API. The pod pushes ports via POST /api/sessions/:hash/ports;
 * we poll GET /api/sessions/:hash/ports with the admin secret.
 */
export async function fetchSessionPorts(hash: string): Promise<number[]> {
  const res = await fetch(`${config.routerServiceUrl}/api/sessions/${hash}/ports`, {
    headers: { "x-admin-secret": config.routerAdminSecret },
  })
  if (!res.ok) {
    throw new Error(`GET /api/sessions/${hash}/ports → HTTP ${res.status}`)
  }
  const body = (await res.json()) as { ports: number[] }
  return body.ports
}

/**
 * Start a recurring polling loop that checks for new dev-server ports reported
 * by the pod to the router, and provisions Traefik IngressRoutes for any newly
 * discovered ports.
 *
 * The loop stops when `stopPodPoller(podName)` is called (on pod deletion).
 */
function startPodPoller(podName: string, hash: string): void {
  const poll = async () => {
    if (!podPollers.has(podName)) return // poller was stopped

    try {
      const ports = await fetchSessionPorts(hash)
      if (ports.length > 0) {
        console.log(`Port poll ${hash}: reported ports = [${ports.join(", ")}]`)
      }

      const already = provisionedPorts.get(hash) ?? new Set<number>()
      const newPorts = ports.filter((p) => !already.has(p))

      for (const port of newPorts) {
        try {
          await provisionPortRoute(hash, port)
          already.add(port)
        } catch (err) {
          console.error(`Failed to provision port ${port} for ${hash}:`, err)
        }
      }
      if (newPorts.length > 0) {
        provisionedPorts.set(hash, already)
      }
    } catch (err) {
      console.error(`Port poll error for ${hash}:`, err)
    }

    if (podPollers.has(podName)) {
      podPollers.set(
        podName,
        setTimeout(() => void poll(), PORT_POLL_INTERVAL_MS),
      )
    }
  }

  podPollers.set(
    podName,
    setTimeout(() => void poll(), PORT_POLL_INTERVAL_MS),
  )
  console.log(`Started port poller for pod ${podName} (hash ${hash}), interval ${PORT_POLL_INTERVAL_MS}ms`)
}

/**
 * Stop the port polling loop for a pod.
 */
function stopPodPoller(podName: string): void {
  const timer = podPollers.get(podName)
  if (timer !== undefined) {
    clearTimeout(timer)
    podPollers.delete(podName)
    console.log(`Stopped port poller for pod ${podName}`)
  }
}

// ---------------------------------------------------------------------------
// Pod watch handlers
// ---------------------------------------------------------------------------

/**
 * Provision Cloudflare DNS record + tunnel route + IngressRoutes for a new session pod.
 * Then starts a background poller that watches for dev-server ports reported to the router.
 */
async function onPodAdded(pod: k8s.V1Pod): Promise<void> {
  const hash = pod.metadata?.labels?.[config.sessionHashLabel]
  if (!hash) return

  const podName = pod.metadata?.name
  if (!podName) return

  const hostname = sessionHostname(hash)
  console.log(`Pod added: ${podName} → provisioning ${hostname}`)

  try {
    const tunnelCname = await getTunnelCname()

    // Create main session route (opencode port)
    await Promise.all([
      createDnsRecord(hostname, tunnelCname),
      createTunnelRoute(hostname),
      createIngressRoutes(hostname),
    ])
    console.log(`Provisioned ${hostname} (main port)`)

    // Initialise the provisioned-ports set for this session
    provisionedPorts.set(hash, new Set<number>())

    // Start background poller for user dev-server ports
    startPodPoller(podName, hash)
  } catch (err) {
    console.error(`Failed to provision ${hostname}:`, err)
  }
}

/**
 * Remove tunnel route + IngressRoutes when a session pod is deleted.
 * DNS record is kept to allow session resumption without NXDOMAIN delay.
 * True termination (including DNS deletion) happens in onPvcDeleted.
 */
async function onPodDeleted(pod: k8s.V1Pod): Promise<void> {
  const hash = pod.metadata?.labels?.[config.sessionHashLabel]
  if (!hash) return

  const podName = pod.metadata?.name
  if (!podName) return

  // Stop background port poller
  stopPodPoller(podName)

  const hostname = sessionHostname(hash)
  console.log(`Pod deleted: ${podName} → removing routing for ${hostname} (DNS kept for resumption)`)

  try {
    const provisioned = provisionedPorts.get(hash) ?? new Set<number>()

    // Remove main session route (keep DNS for resumption)
    await Promise.all([deleteTunnelRoute(hostname), deleteIngressRoutes(hostname)])
    console.log(`Removed routing for ${hostname}`)

    // Remove per-port IngressRoutes (no Cloudflare DNS/tunnel per port — wildcard covers it)
    for (const port of provisioned) {
      const portHostname = sessionPortHostname(hash, port)
      try {
        await deleteIngressRoutes(portHostname)
        console.log(`Removed IngressRoutes for ${portHostname} (port ${port})`)
      } catch (err) {
        console.error(`Failed to remove IngressRoutes for ${portHostname}:`, err)
      }
    }

    provisionedPorts.delete(hash)
  } catch (err) {
    console.error(`Failed to remove routing for ${hostname}:`, err)
  }
}

/**
 * Delete DNS record when session PVC is deleted (true session termination).
 * This is the signal that the session is permanently gone.
 */
async function onPvcDeleted(pvc: k8s.V1PersistentVolumeClaim): Promise<void> {
  const hash = pvc.metadata?.labels?.[config.sessionHashLabel]
  if (!hash) return

  const hostname = sessionHostname(hash)
  console.log(`PVC deleted: ${pvc.metadata?.name} → terminating ${hostname}`)

  try {
    await Promise.all([deleteDnsRecord(hostname), deleteTunnelRoute(hostname)])
    console.log(`Terminated ${hostname}`)
  } catch (err) {
    console.error(`Failed to terminate ${hostname}:`, err)
  }
}

// ---------------------------------------------------------------------------
// Pod watch
// ---------------------------------------------------------------------------

/**
 * Start watching pods with exponential backoff on failure.
 */
async function startWatch(): Promise<void> {
  const watch = new k8s.Watch(kc)
  let backoffMs = 1000

  const doWatch = async (): Promise<void> => {
    console.log(`Watching pods in namespace "${config.watchNamespace}" ` + `with selector "${config.podLabelSelector}"`)

    try {
      await watch.watch(
        `/api/v1/namespaces/${config.watchNamespace}/pods`,
        { labelSelector: config.podLabelSelector },
        (eventType: string, pod: k8s.V1Pod) => {
          if (eventType === "ADDED") {
            void onPodAdded(pod)
          } else if (eventType === "DELETED") {
            void onPodDeleted(pod)
          }
          // MODIFIED: ignore — we don't need to react to pod updates
        },
        (err: unknown) => {
          if (err) {
            console.error("Watch stream error:", err)
          } else {
            console.log("Watch stream ended — restarting")
          }
          backoffMs = Math.min(backoffMs * 2, 30_000)
          setTimeout(() => void doWatch(), backoffMs)
        },
      )
      // Reset backoff on successful connection
      backoffMs = 1000
    } catch (err) {
      console.error("Watch setup error:", err)
      setTimeout(() => void doWatch(), backoffMs)
      backoffMs = Math.min(backoffMs * 2, 30_000)
    }
  }

  await doWatch()
}

/**
 * Start watching PVCs to detect session termination.
 * DNS is only deleted when PVC is deleted (not on pod stop).
 */
async function startPvcWatch(): Promise<void> {
  const watch = new k8s.Watch(kc)
  let backoffMs = 1000

  const doWatch = async (): Promise<void> => {
    console.log(`Watching PVCs in namespace "${config.watchNamespace}" ` + `with selector "${PVC_LABEL_SELECTOR}"`)

    try {
      await watch.watch(
        `/api/v1/namespaces/${config.watchNamespace}/persistentvolumeclaims`,
        { labelSelector: PVC_LABEL_SELECTOR },
        (eventType: string, pvc: k8s.V1PersistentVolumeClaim) => {
          if (eventType === "DELETED") {
            void onPvcDeleted(pvc)
          }
        },
        (err: unknown) => {
          if (err) {
            console.error("PVC watch stream error:", err)
          } else {
            console.log("PVC watch stream ended — restarting")
          }
          backoffMs = Math.min(backoffMs * 2, 30_000)
          setTimeout(() => void doWatch(), backoffMs)
        },
      )
      backoffMs = 1000
    } catch (err) {
      console.error("PVC watch setup error:", err)
      setTimeout(() => void doWatch(), backoffMs)
      backoffMs = Math.min(backoffMs * 2, 30_000)
    }
  }

  await doWatch()
}

// ---------------------------------------------------------------------------
// Health check server
// ---------------------------------------------------------------------------

const healthServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok")
  } else {
    res.writeHead(404).end()
  }
})

healthServer.listen(config.healthPort, () => {
  console.log(`Health server listening on :${config.healthPort}`)
})

// ---------------------------------------------------------------------------
// Startup reconciliation
// ---------------------------------------------------------------------------

/**
 * On startup, reconcile Kubernetes IngressRoutes and Cloudflare tunnel routes
 * against the set of live pods and PVCs.
 *
 * IngressRoutes are scoped to pod lifetime: delete any whose hash has no live pod.
 * Tunnel routes + DNS are scoped to PVC lifetime: delete any whose hash has no PVC
 * (sessions with a PVC but no pod keep their DNS for resumption).
 *
 * This handles the case where the operator missed DELETED events (e.g. after a
 * restart) and the in-memory provisionedPorts map was lost.
 */
async function reconcileOnStartup(): Promise<void> {
  console.log("Reconciling existing resources against live pods/PVCs…")

  const coreApi = kc.makeApiClient(k8s.CoreV1Api)

  // Fetch live pod hashes
  const podList = await coreApi.listNamespacedPod({
    namespace: config.watchNamespace,
    labelSelector: config.podLabelSelector,
  })
  const livePodHashes = new Set(
    podList.items.flatMap((p) => {
      const h = p.metadata?.labels?.[config.sessionHashLabel]
      return h ? [h] : []
    }),
  )

  // Fetch live PVC hashes (sessions that still exist, even if pod is stopped)
  const pvcList = await coreApi.listNamespacedPersistentVolumeClaim({
    namespace: config.watchNamespace,
    labelSelector: PVC_LABEL_SELECTOR,
  })
  const livePvcHashes = new Set(
    pvcList.items.flatMap((p) => {
      const h = p.metadata?.labels?.[config.sessionHashLabel]
      return h ? [h] : []
    }),
  )

  console.log(`  Live pod hashes : [${[...livePodHashes].join(", ")}]`)
  console.log(`  Live PVC hashes : [${[...livePvcHashes].join(", ")}]`)

  // --- IngressRoutes: delete any whose hash has no live pod ---
  const routeNames = await listManagedIngressRoutes()
  // Name pattern: opencode-session-<firstLabel>-app / -signin
  // firstLabel is either "<hash>-oc" (main) or "<port>-<hash>-oc" (port route)
  const routeSuffix = config.routeSuffix // e.g. "-oc"
  const hashFromFirstLabel = (firstLabel: string): string | null => {
    // main route:  "<hash>-oc"       → strip suffix
    if (firstLabel.endsWith(routeSuffix)) {
      const withoutSuffix = firstLabel.slice(0, -routeSuffix.length)
      // port route: "<port>-<hash>" → take last segment
      const parts = withoutSuffix.split("-")
      return parts[parts.length - 1].length === 12 ? parts[parts.length - 1] : withoutSuffix
    }
    return null
  }

  for (const name of routeNames) {
    // Strip "opencode-session-" prefix and "-app"/"-signin" suffix
    const inner = name.replace(/^opencode-session-/, "").replace(/-(app|signin)$/, "")
    const hash = hashFromFirstLabel(inner)
    if (!hash) {
      console.log(`  Skipping unrecognised IngressRoute: ${name}`)
      continue
    }
    if (!livePodHashes.has(hash)) {
      console.log(`  Deleting stale IngressRoute ${name} (hash ${hash} has no live pod)`)
      // deleteIngressRoutes expects a hostname; we reconstruct it
      const hostname = `${inner}.${config.domain}`
      try {
        await deleteIngressRoutes(hostname)
      } catch (err) {
        console.error(`  Failed to delete IngressRoute ${name}:`, err)
      }
    }
  }

  // --- Tunnel routes: delete any whose hash has no live PVC ---
  const tunnelHostnames = await getTunnelRouteHostnames()
  for (const hostname of tunnelHostnames) {
    // hostname: "<hash>-oc.<domain>" or "<port>-<hash>-oc.<domain>"
    const firstLabel = hostname.split(".")[0] // e.g. "8803d24a0085-oc" or "5173-8803d24a0085-oc"
    const hash = hashFromFirstLabel(firstLabel)
    if (!hash) {
      console.log(`  Skipping unrecognised tunnel route: ${hostname}`)
      continue
    }
    if (!livePvcHashes.has(hash)) {
      console.log(`  Deleting stale tunnel route ${hostname} (hash ${hash} has no live PVC)`)
      try {
        await deleteTunnelRoute(hostname)
        // Also try to clean up DNS (idempotent if already gone)
        await deleteDnsRecord(hostname)
      } catch (err) {
        console.error(`  Failed to delete tunnel route/DNS for ${hostname}:`, err)
      }
    }
  }

  console.log("Reconciliation complete.")
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("opencode-cloudflare-operator starting")
console.log(`  Domain            : ${config.domain}`)
console.log(`  Route suffix      : "${config.routeSuffix}"`)
console.log(`  Session URL       : <hash>${config.routeSuffix}.${config.domain}`)
console.log(`  Router svc        : ${config.routerServiceUrl}`)
console.log(`  Tunnel ID         : ${config.cfTunnelId}`)
console.log(`  IngressRoute ns   : ${config.ingressRouteNamespace}`)
console.log(`  OAuth2 middleware  : ${config.oauth2ChainMiddleware}`)
console.log(`  Router svc name   : ${config.routerServiceName}`)
console.log(`  Port poll interval: ${PORT_POLL_INTERVAL_MS}ms`)

void reconcileOnStartup().then(() => {
  void startWatch()
  void startPvcWatch()
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(): void {
  console.log("Shutting down...")
  healthServer.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
