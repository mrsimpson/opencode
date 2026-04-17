// Set environment variables BEFORE importing modules
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
process.env.ROUTE_SUFFIX = "-oc"

import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

// Mock config - this will override the real config module
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

// Mock state for assertions
const cfDnsRecords: Map<string, { id: string; name: string; content: string }> = new Map()
const cfTunnelIngress: { hostname?: string; service: string }[] = [
  { service: "http://traefik-controller.traefik-system.svc.cluster.local:80" },
]
const k8sRequests: { method: string; path: string; body?: unknown }[] = []

function resetState() {
  cfDnsRecords.clear()
  while (cfTunnelIngress.length > 1) {
    cfTunnelIngress.pop()
  }
  k8sRequests.length = 0
}

// Mock fetch for Cloudflare API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn<any, any>(async (url: any, options?: any) => {
  const urlStr = typeof url === "string" ? url : url.toString()
  const body = options?.body ? JSON.parse(options.body) : undefined

  if (urlStr.match(/\/zones\/zone123$/) && options?.method === "GET") {
    return new Response(JSON.stringify({ success: true, result: { account: { id: "account123" } } }))
  }

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

  if (urlStr.includes("/configurations")) {
    if (options?.method === "GET") {
      return new Response(JSON.stringify({ success: true, result: { config: { ingress: cfTunnelIngress } } }))
    }
    if (options?.method === "PUT") {
      cfTunnelIngress.length = 0
      cfTunnelIngress.push(...body.config.ingress)
      return new Response(JSON.stringify({ success: true }))
    }
  }

  return new Response(JSON.stringify({ success: false, errors: [{ message: "Not found" }] }), { status: 404 })
})

Object.defineProperty(globalThis, "fetch", { value: mockFetch, configurable: true, writable: true })

// Mock Kubernetes client
vi.mock("@kubernetes/client-node", () => {
  function MockKubeConfig() {}
  MockKubeConfig.prototype.loadFromDefault = vi.fn()
  MockKubeConfig.prototype.loadFromCluster = vi.fn()
  MockKubeConfig.prototype.makeApiClient = vi.fn().mockReturnValue({
    createNamespacedCustomObject: vi.fn().mockImplementation(async (opts: any) => {
      k8sRequests.push({ method: "POST", path: `/${opts.namespace}/${opts.plural}`, body: opts.body })
      return { body: {} }
    }),
    deleteNamespacedCustomObject: vi.fn().mockImplementation(async (opts: any) => {
      k8sRequests.push({ method: "DELETE", path: `/${opts.namespace}/${opts.plural}/${opts.name}` })
      return { body: {} }
    }),
  })

  return {
    KubeConfig: MockKubeConfig,
    Watch: function MockWatch() {},
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

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

import * as cloudflare from "../src/cloudflare.js"
import * as ingressroute from "../src/ingressroute.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH = "191adb184b2b"
const HOSTNAME = `${HASH}-oc.no-panic.org`

const mockConfig = {
  oauth2ChainMiddleware: "code-oauth2-chain",
}

function pod(hash = HASH) {
  return {
    metadata: {
      name: `opencode-session-${hash}`,
      labels: {
        "opencode.ai/session-hash": hash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
    },
  } as const
}

function pvc(hash = HASH) {
  return {
    metadata: {
      name: `opencode-session-${hash}`,
      labels: {
        "opencode.ai/session-hash": hash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
    },
  } as const
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetState()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Cloudflare API tests
// ---------------------------------------------------------------------------

describe("Cloudflare API (cloudflare.ts)", () => {
  describe("findDnsRecord", () => {
    it("returns null when no record exists", async () => {
      const result = await cloudflare.findDnsRecord(HOSTNAME)
      expect(result).toBeNull()
    })

    it("returns record id when exists", async () => {
      cfDnsRecords.set(HOSTNAME, { id: "abc123", name: HOSTNAME, content: "tunnel.cfargotunnel.com" })
      const result = await cloudflare.findDnsRecord(HOSTNAME)
      expect(result).toBe("abc123")
    })
  })

  describe("createDnsRecord", () => {
    it("creates DNS record when none exists", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
      expect(cfDnsRecords.get(HOSTNAME)?.content).toBe("tunnel123.cfargotunnel.com")
    })

    it("skips when record already exists", async () => {
      cfDnsRecords.set(HOSTNAME, { id: "existing", name: HOSTNAME, content: "old.cfargotunnel.com" })
      await cloudflare.createDnsRecord(HOSTNAME, "new.cfargotunnel.com")
      expect(cfDnsRecords.get(HOSTNAME)?.content).toBe("old.cfargotunnel.com")
    })
  })

  describe("deleteDnsRecord", () => {
    it("deletes existing record", async () => {
      cfDnsRecords.set(HOSTNAME, { id: "abc123", name: HOSTNAME, content: "tunnel.cfargotunnel.com" })
      await cloudflare.deleteDnsRecord(HOSTNAME)
      expect(cfDnsRecords.has(HOSTNAME)).toBe(false)
    })

    it("handles non-existent record gracefully", async () => {
      await expect(cloudflare.deleteDnsRecord(HOSTNAME)).resolves.not.toThrow()
    })
  })

  describe("createTunnelRoute", () => {
    it("adds hostname to tunnel ingress", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })

    it("skips if route already exists", async () => {
      cfTunnelIngress.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.createTunnelRoute(HOSTNAME)
      // Route still exists, no error
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })
  })

  describe("deleteTunnelRoute", () => {
    it("removes hostname from tunnel ingress", async () => {
      cfTunnelIngress.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })

    it("handles non-existent route gracefully", async () => {
      await expect(cloudflare.deleteTunnelRoute(HOSTNAME)).resolves.not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// IngressRoute tests
// ---------------------------------------------------------------------------

describe("IngressRoute API (ingressroute.ts)", () => {
  describe("createIngressRoutes", () => {
    it("creates app and signin IngressRoutes", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)
      const appRequest = k8sRequests.find(
        (r) => r.path.includes("ingressroutes") && (r.body as any)?.metadata?.name?.includes("oc-app"),
      )
      const signinRequest = k8sRequests.find(
        (r) => r.path.includes("ingressroutes") && (r.body as any)?.metadata?.name?.includes("oc-signin"),
      )
      expect(appRequest?.method).toBe("POST")
      expect(signinRequest?.method).toBe("POST")
    })

    it("sets correct host in IngressRoute spec", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)
      const appRequest = k8sRequests.find(
        (r) => r.method === "POST" && (r.body as any)?.metadata?.name?.includes("oc-app"),
      )
      expect(appRequest).toBeDefined()
      expect(appRequest?.body).toMatchObject({
        metadata: { name: expect.stringContaining("oc-app") },
        spec: {
          routes: [{ match: expect.stringContaining(HOSTNAME) }],
        },
      })
    })

    it("adds oauth2 chain middleware to app route", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)
      const appRequest = k8sRequests.find(
        (r) => r.method === "POST" && (r.body as any)?.metadata?.name?.includes("oc-app"),
      )
      expect(appRequest).toBeDefined()
      expect(appRequest?.body).toMatchObject({
        spec: { routes: [{ middlewares: [{ name: mockConfig.oauth2ChainMiddleware }] }] },
      })
    })
  })

  describe("deleteIngressRoutes", () => {
    it("deletes both IngressRoutes", async () => {
      await ingressroute.deleteIngressRoutes(HOSTNAME)
      const appDelete = k8sRequests.find((r) => r.path.includes("oc-app") && r.method === "DELETE")
      const signinDelete = k8sRequests.find((r) => r.path.includes("oc-signin") && r.method === "DELETE")
      expect(appDelete).toBeDefined()
      expect(signinDelete).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// Integration: Full session lifecycle
// ---------------------------------------------------------------------------

describe("Full session lifecycle", () => {
  describe("New session (pod added)", () => {
    it("creates DNS, tunnel route, and IngressRoutes", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await ingressroute.createIngressRoutes(HOSTNAME)
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(true)
      expect(k8sRequests.filter((r) => r.method === "POST" && r.path.includes("ingressroutes")).length).toBe(2)
    })
  })

  describe("Session stop (pod deleted) - DNS should be preserved", () => {
    beforeEach(async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await ingressroute.createIngressRoutes(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      await ingressroute.deleteIngressRoutes(HOSTNAME)
      k8sRequests.length = 0
    })

    it("DNS is preserved after stop", async () => {
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("tunnel route is removed after stop", async () => {
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })
  })

  describe("Session resume (pod added again)", () => {
    beforeEach(async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
    })

    it("reuses existing DNS (no creation)", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("recreates tunnel route", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })
  })

  describe("Session termination (PVC deleted) - full cleanup", () => {
    beforeEach(async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
    })

    it("deletes DNS record", async () => {
      await cloudflare.deleteDnsRecord(HOSTNAME)
      expect(cfDnsRecords.has(HOSTNAME)).toBe(false)
    })

    it("deletes tunnel route", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  beforeEach(() => {
    resetState()
  })

  it("multiple sessions are independent", async () => {
    const hash1 = "aaaaaaaaaaaa"
    const hash2 = "bbbbbbbbbbbb"
    const host1 = `${hash1}-oc.no-panic.org`
    const host2 = `${hash2}-oc.no-panic.org`

    await cloudflare.createDnsRecord(host1, "tunnel.cfargotunnel.com")
    await cloudflare.createDnsRecord(host2, "tunnel.cfargotunnel.com")
    expect(cfDnsRecords.has(host1)).toBe(true)
    expect(cfDnsRecords.has(host2)).toBe(true)

    await cloudflare.createTunnelRoute(host1)
    await cloudflare.deleteTunnelRoute(host1)
    expect(cfDnsRecords.has(host1)).toBe(true)
    expect(cfDnsRecords.has(host2)).toBe(true)
  })

  it("handles DNS already deleted on termination gracefully", async () => {
    expect(cfDnsRecords.has(HOSTNAME)).toBe(false)
    await expect(cloudflare.deleteDnsRecord(HOSTNAME)).resolves.not.toThrow()
  })

  it("handles tunnel already cleaned up gracefully", async () => {
    expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    await cloudflare.deleteTunnelRoute(HOSTNAME)
    expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
  })
})
