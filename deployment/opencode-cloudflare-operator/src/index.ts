import http from "node:http"
import * as k8s from "@kubernetes/client-node"
import { config, sessionHostname } from "./config.js"
import { createDnsRecord, createTunnelRoute, deleteDnsRecord, deleteTunnelRoute, getTunnelCname } from "./cloudflare.js"
import { createIngressRoutes, deleteIngressRoutes } from "./ingressroute.js"

/** Label selector for session PVCs (used to detect termination) */
const PVC_LABEL_SELECTOR = "app.kubernetes.io/managed-by=opencode-router"

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
// Pod watch
// ---------------------------------------------------------------------------

/**
 * Provision Cloudflare DNS record + tunnel route for a new session pod.
 */
async function onPodAdded(pod: k8s.V1Pod): Promise<void> {
  const hash = pod.metadata?.labels?.[config.sessionHashLabel]
  if (!hash) return

  const hostname = sessionHostname(hash)
  console.log(`Pod added: ${pod.metadata?.name} → provisioning ${hostname}`)

  try {
    const tunnelCname = await getTunnelCname()
    // Create DNS record, tunnel route, and Traefik IngressRoutes in parallel
    await Promise.all([
      createDnsRecord(hostname, tunnelCname),
      createTunnelRoute(hostname),
      createIngressRoutes(hostname),
    ])
    console.log(`Provisioned ${hostname}`)
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

  const hostname = sessionHostname(hash)
  console.log(`Pod deleted: ${pod.metadata?.name} → removing routing for ${hostname} (DNS kept for resumption)`)

  try {
    await Promise.all([
      // Keep DNS: allows resumption without NXDOMAIN
      deleteTunnelRoute(hostname),
      deleteIngressRoutes(hostname),
    ])
    console.log(`Removed routing for ${hostname}`)
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

void startWatch()
void startPvcWatch()

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
