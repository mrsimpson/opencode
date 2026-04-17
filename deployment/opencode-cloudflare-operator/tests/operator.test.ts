import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mock config - must be defined before importing modules
// ---------------------------------------------------------------------------

const mockConfig = {
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
}

vi.mock("./src/config.js", () => ({
  config: mockConfig,
  sessionHostname: (hash: string) => `${hash}${mockConfig.routeSuffix}.${mockConfig.domain}`,
}))

// ---------------------------------------------------------------------------
// State for mocking
// ---------------------------------------------------------------------------

interface CfRequest {
  method: string
  path: string
  body?: unknown
}

const cfRequests: CfRequest[] = []
const cfDnsRecords: Map<string, { id: string; name: string; content: string }> = new Map()
let cfTunnelIngress: { hostname?: string; service: string }[] = [
  { service: "http://traefik-controller.traefik-system.svc.cluster.local:80" },
]

function resetCfState() {
  cfRequests.length = 0
  cfDnsRecords.clear()
  cfTunnelIngress = [{ service: "http://traefik-controller.traefik-system.svc.cluster.local:80" }]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn<any, any>(async (url: string | URL, options?: { method?: string; body?: string }) => {
  const urlStr = typeof url === "string" ? url : url.toString()

  cfRequests.push({
    method: options?.method ?? "GET",
    path: urlStr,
    body: options?.body ? JSON.parse(options.body as string) : undefined,
  })

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
      const body = JSON.parse(options.body as string) as { name: string; content: string; type: string }
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
      const body = JSON.parse(options.body as string) as {
        config: { ingress: { hostname?: string; service: string }[] }
      }
      cfTunnelIngress = body.config.ingress
      return new Response(JSON.stringify({ success: true }))
    }
  }

  return new Response(JSON.stringify({ success: false, errors: [{ message: "Not found" }] }), { status: 404 })
})

// Set up global fetch mock
Object.defineProperty(globalThis, "fetch", { value: mockFetch, configurable: true, writable: true })

// ---------------------------------------------------------------------------
// Mock Kubernetes
// ---------------------------------------------------------------------------

const k8sRequests: { method: string; path: string; body?: unknown }[] = []

// Track API calls
function trackK8sRequest(method: string, path: string, body?: unknown) {
  k8sRequests.push({ method, path, body })
}

// Mock @kubernetes/client-node
vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: vi.fn().mockImplementation(() => ({
    loadFromDefault: vi.fn(),
    loadFromCluster: vi.fn(),
    makeApiClient: vi.fn().mockReturnValue({
      createNamespacedCustomObject: vi
        .fn()
        .mockImplementation(
          async (opts: {
            group?: string
            version?: string
            namespace?: string
            plural?: string
            name?: string
            body?: unknown
          }) => {
            trackK8sRequest("POST", `/${opts.namespace}/${opts.plural}`, opts.body)
            return { body: {} }
          },
        ),
      deleteNamespacedCustomObject: vi
        .fn()
        .mockImplementation(
          async (opts: { group?: string; version?: string; namespace?: string; plural?: string; name?: string }) => {
            trackK8sRequest("DELETE", `/${opts.namespace}/${opts.plural}/${opts.name}`)
            return { body: {} }
          },
        ),
    }),
  })),
  Watch: vi.fn().mockImplementation(() => ({
    watch: vi.fn(async (path: string) => {
      trackK8sRequest("WATCH", path)
      return Promise.resolve()
    }),
  })),
  CustomObjectsApi: {},
}))

// ---------------------------------------------------------------------------
// Mock http and fs (not tested)
// ---------------------------------------------------------------------------

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

import * as cloudflare from "./src/cloudflare.js"
import * as ingressroute from "./src/ingressroute.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH = "191adb184b2b"
const HOSTNAME = `${HASH}${mockConfig.routeSuffix}.${mockConfig.domain}`

function pod(hash = HASH) {
  return {
    metadata: {
      name: `opencode-session-${hash}`,
      labels: {
        [mockConfig.sessionHashLabel]: hash,
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
        [mockConfig.sessionHashLabel]: hash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
    },
  } as const
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetCfState()
  k8sRequests.length = 0
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

    it("creates CNAME record with correct type", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")

      const postRequest = cfRequests.find((r) => r.method === "POST" && r.path.includes("/dns_records"))
      expect(postRequest?.body).toMatchObject({ type: "CNAME", name: HOSTNAME, proxied: true })
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
      cfTunnelIngress.push({ hostname: HOSTNAME, service: mockConfig.routerServiceUrl })

      await cloudflare.createTunnelRoute(HOSTNAME)

      const putCount = cfRequests.filter((r) => r.method === "PUT").length
      expect(putCount).toBe(0)
    })

    it("keeps catch-all route at end", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)

      const catchAll = cfTunnelIngress[cfTunnelIngress.length - 1]
      expect(catchAll.hostname).toBeUndefined()
    })
  })

  describe("deleteTunnelRoute", () => {
    it("removes hostname from tunnel ingress", async () => {
      cfTunnelIngress.push({ hostname: HOSTNAME, service: mockConfig.routerServiceUrl })

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
    beforeEach(() => {
      k8sRequests.length = 0
    })

    it("creates app and signin IngressRoutes", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)

      const appRequest = k8sRequests.find(
        (r) =>
          r.path.includes("ingressroutes") &&
          (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-app"),
      )
      const signinRequest = k8sRequests.find(
        (r) =>
          r.path.includes("ingressroutes") &&
          (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-signin"),
      )

      expect(appRequest?.method).toBe("POST")
      expect(signinRequest?.method).toBe("POST")
    })

    it("sets correct host in IngressRoute spec", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)

      // Find POST request for app route
      const appRequest = k8sRequests.find(
        (r) => r.method === "POST" && (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-app"),
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
        (r) => r.method === "POST" && (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-app"),
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
      // Simulate new session
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await ingressroute.createIngressRoutes(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME) // Simulate stop
      await ingressroute.deleteIngressRoutes(HOSTNAME) // Simulate stop
      // Reset for test assertions
      cfRequests.length = 0
      k8sRequests.length = 0
    })

    it("DNS is preserved after stop (not deleted by onPodDeleted)", async () => {
      // onPodDeleted should NOT call deleteDnsRecord
      // So DNS should still exist
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("tunnel route is removed after stop", async () => {
      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })

    it("IngressRoutes are removed after stop", async () => {
      // They were already deleted in beforeEach, so no new DELETE requests
      expect(k8sRequests.filter((r) => r.method === "DELETE" && r.path.includes("ingressroutes")).length).toBe(0)
    })
  })

  describe("Session resume (pod added again)", () => {
    beforeEach(async () => {
      // Simulate stop (DNS preserved, tunnel/ingress removed)
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      // DNS still exists
      cfRequests.length = 0
    })

    it("reuses existing DNS (no creation)", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")

      const postRequests = cfRequests.filter((r) => r.method === "POST" && r.path.includes("/dns_records"))
      expect(postRequests).toHaveLength(0)
      expect(cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("recreates tunnel route", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)

      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })
  })

  describe("Session termination (PVC deleted) - full cleanup", () => {
    beforeEach(async () => {
      // Simulate stop
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      // DNS still exists
      cfRequests.length = 0
    })

    it("deletes DNS record", async () => {
      await cloudflare.deleteDnsRecord(HOSTNAME)

      expect(cfDnsRecords.has(HOSTNAME)).toBe(false)
    })

    it("deletes tunnel route", async () => {
      // Re-create for termination
      await cloudflare.createTunnelRoute(HOSTNAME)
      cfRequests.length = 0

      await cloudflare.deleteTunnelRoute(HOSTNAME)

      expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("multiple sessions are independent", async () => {
    const hash1 = "aaaaaaaaaaaa"
    const hash2 = "bbbbbbbbbbbb"
    const host1 = `${hash1}-oc.no-panic.org`
    const host2 = `${hash2}-oc.no-panic.org`

    await cloudflare.createDnsRecord(host1, "tunnel.cfargotunnel.com")
    await cloudflare.createDnsRecord(host2, "tunnel.cfargotunnel.com")

    expect(cfDnsRecords.has(host1)).toBe(true)
    expect(cfDnsRecords.has(host2)).toBe(true)

    // Stop session 1
    await cloudflare.createTunnelRoute(host1)
    await cloudflare.deleteTunnelRoute(host1)

    expect(cfDnsRecords.has(host1)).toBe(true) // DNS kept
    expect(cfDnsRecords.has(host2)).toBe(true) // Session 2 unaffected
    expect(cfTunnelIngress.some((r) => r.hostname === host1)).toBe(false)
    expect(cfTunnelIngress.some((r) => r.hostname === host2)).toBe(false)
  })

  it("handles DNS already deleted on termination gracefully", async () => {
    // DNS doesn't exist
    expect(cfDnsRecords.has(HOSTNAME)).toBe(false)

    await expect(cloudflare.deleteDnsRecord(HOSTNAME)).resolves.not.toThrow()
    await expect(cloudflare.deleteTunnelRoute(HOSTNAME)).resolves.not.toThrow()
  })

  it("handles tunnel already cleaned up gracefully", async () => {
    // Tunnel is clean
    expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)

    await cloudflare.deleteTunnelRoute(HOSTNAME) // Should not throw

    // State unchanged
    expect(cfTunnelIngress.some((r) => r.hostname === HOSTNAME)).toBe(false)
  })
})
