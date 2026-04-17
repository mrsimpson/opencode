// Setup environment variables and mocks for tests
// This file is run before test files are loaded (vitest setupFiles)

import { vi } from "vitest"

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

process.env.CF_API_TOKEN = "test-token"
process.env.CF_ZONE_ID = "zone123"
process.env.CF_TUNNEL_ID = "tunnel123"
process.env.DOMAIN = "no-panic.org"
process.env.ROUTER_SERVICE_URL = "http://traefik-controller.traefik-system.svc.cluster.local:80"
process.env.WATCH_NAMESPACE = "code"
process.env.POD_LABEL_SELECTOR = "app.kubernetes.io/managed-by=opencode-router"
process.env.INGRESSROUTE_NAMESPACE = "code"
process.env.OAUTH2_CHAIN_MIDDLEWARE = "code-oauth2-chain"
process.env.ROUTER_SERVICE_NAME = "code"
process.env.HEALTH_PORT = "8080"

// ---------------------------------------------------------------------------
// Mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

// Mock config module
vi.mock("../src/config.js", () => ({
  config: {
    watchNamespace: "code",
    podLabelSelector: "app.kubernetes.io/managed-by=opencode-router",
    sessionHashLabel: "opencode.ai/session-hash",
    cfApiToken: "test-token",
    cfZoneId: "zone123",
    cfTunnelId: "tunnel123",
    domain: "no-panic.org",
    routeSuffix: "-oc",
    routerServiceUrl: "http://traefik-controller.traefik-system.svc.cluster.local:80",
    healthPort: 8080,
    ingressRouteNamespace: "code",
    oauth2ChainMiddleware: "code-oauth2-chain",
    routerServiceName: "code",
  },
  sessionHostname: (hash: string) => `${hash}-oc.no-panic.org`,
}))

// Mock fetch
const cfDnsRecords: Map<string, { id: string; name: string; content: string }> = new Map()
const cfTunnelIngress: { hostname?: string; service: string }[] = [
  { service: "http://traefik-controller.traefik-system.svc.cluster.local:80" },
]

// Export for use in tests
export const mockState = {
  cfDnsRecords,
  get cfTunnel() {
    return cfTunnelIngress
  },
  k8sRequests: [] as { method: string; path: string; body?: unknown }[],
  reset() {
    cfDnsRecords.clear()
    // Clear all entries including hostnames, keep only catchall
    while (cfTunnelIngress.length > 1) {
      cfTunnelIngress.pop()
    }
    this.k8sRequests.length = 0
  },
}

// Helper to update tunnel ingress (used in mock)
function updateTunnelIngress(ingress: { hostname?: string; service: string }[]) {
  cfTunnelIngress.length = 0
  cfTunnelIngress.push(...ingress)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn<any, any>(async (url: string | URL, options?: { method?: string; body?: string }) => {
  const urlStr = typeof url === "string" ? url : url.toString()
  const body = options?.body ? JSON.parse(options.body as string) : undefined

  // Zone lookup
  if (urlStr.match(/\/zones\/zone123$/) && options?.method === "GET") {
    return new Response(JSON.stringify({ success: true, result: { account: { id: "account123" } } }))
  }

  // DNS records
  if (urlStr.includes("/dns_records")) {
    const urlObj = new URL(urlStr)

    if (options?.method === "GET") {
      const name = urlObj.searchParams.get("name")
      if (name) {
        const record = cfDnsRecords.get(name)
        return new Response(JSON.stringify({ success: true, result: record ? [record] : [] }))
      }
      return new Response(JSON.stringify({ success: true, result: Array.from(cfDnsRecords.values()) }))
    }

    if (options?.method === "POST") {
      const id = `dns-${Date.now()}`
      cfDnsRecords.set(body.name, { id, name: body.name, content: body.content })
      return new Response(JSON.stringify({ success: true, result: { id, name: body.name } }))
    }

    if (options?.method === "DELETE") {
      const id = urlStr.split("/dns_records/")[1]
      for (const [name, record] of cfDnsRecords) {
        if (record.id === id) {
          cfDnsRecords.delete(name)
          break
        }
      }
      return new Response(JSON.stringify({ success: true }))
    }
  }

  // Tunnel config
  if (urlStr.includes("/configurations")) {
    if (options?.method === "GET") {
      return new Response(JSON.stringify({ success: true, result: { config: { ingress: cfTunnelIngress } } }))
    }
    if (options?.method === "PUT") {
      updateTunnelIngress(body.config.ingress)
      return new Response(JSON.stringify({ success: true }))
    }
  }

  return new Response(JSON.stringify({ success: false, errors: [{ message: "Not found" }] }), { status: 404 })
})

Object.defineProperty(globalThis, "fetch", { value: mockFetch, configurable: true, writable: true })

// Mock Kubernetes client
vi.mock("@kubernetes/client-node", () => {
  function MockKubeConfig() {
    this.loadFromDefault = vi.fn()
    this.loadFromCluster = vi.fn()
    this.makeApiClient = vi.fn().mockReturnValue({
      createNamespacedCustomObject: vi
        .fn()
        .mockImplementation(async (opts: { namespace?: string; plural?: string; name?: string; body?: unknown }) => {
          mockState.k8sRequests.push({ method: "POST", path: `/${opts.namespace}/${opts.plural}`, body: opts.body })
          return { body: {} }
        }),
      deleteNamespacedCustomObject: vi
        .fn()
        .mockImplementation(async (opts: { namespace?: string; plural?: string; name?: string }) => {
          mockState.k8sRequests.push({ method: "DELETE", path: `/${opts.namespace}/${opts.plural}/${opts.name}` })
          return { body: {} }
        }),
    })
  }

  function MockWatch() {
    this.watch = vi.fn().mockImplementation(async (path: string) => {
      mockState.k8sRequests.push({ method: "WATCH", path })
      return Promise.resolve()
    })
  }

  return {
    KubeConfig: MockKubeConfig,
    Watch: MockWatch,
    CustomObjectsApi: {},
  }
})

// Mock http and fs
vi.mock("node:http", () => ({
  default: {
    createServer: vi.fn(() => ({ listen: vi.fn(), close: vi.fn() })),
  },
}))

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => false) },
  existsSync: vi.fn(() => false),
}))
