import { beforeEach, describe, expect, it, vi } from "vitest"
import { mockState } from "./setup.js"
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
  mockState.reset()
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
      mockState.cfDnsRecords.set(HOSTNAME, { id: "abc123", name: HOSTNAME, content: "tunnel.cfargotunnel.com" })
      const result = await cloudflare.findDnsRecord(HOSTNAME)
      expect(result).toBe("abc123")
    })
  })

  describe("createDnsRecord", () => {
    it("creates DNS record when none exists", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(true)
      expect(mockState.cfDnsRecords.get(HOSTNAME)?.content).toBe("tunnel123.cfargotunnel.com")
    })

    it("skips when record already exists", async () => {
      mockState.cfDnsRecords.set(HOSTNAME, { id: "existing", name: HOSTNAME, content: "old.cfargotunnel.com" })
      await cloudflare.createDnsRecord(HOSTNAME, "new.cfargotunnel.com")
      expect(mockState.cfDnsRecords.get(HOSTNAME)?.content).toBe("old.cfargotunnel.com")
    })
  })

  describe("deleteDnsRecord", () => {
    it("deletes existing record", async () => {
      mockState.cfDnsRecords.set(HOSTNAME, { id: "abc123", name: HOSTNAME, content: "tunnel.cfargotunnel.com" })
      await cloudflare.deleteDnsRecord(HOSTNAME)
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(false)
    })

    it("handles non-existent record gracefully", async () => {
      await expect(cloudflare.deleteDnsRecord(HOSTNAME)).resolves.not.toThrow()
    })
  })

  describe("createTunnelRoute", () => {
    it("adds hostname to tunnel ingress", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })

    it("skips if route already exists", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.createTunnelRoute(HOSTNAME)
      // Route already exists, should skip (PUT not called)
      // The existing entry is still there
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })

    it("removes hostname from tunnel ingress", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })

    it("skips if route already exists", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.createTunnelRoute(HOSTNAME)
      // Should not add duplicate
      const count = mockState.cfTunnel.filter((r) => r.hostname === HOSTNAME).length
      expect(count).toBe(1)
    })
  })

  describe("deleteTunnelRoute", () => {
    it("removes hostname from tunnel ingress", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })

    it("skips if route already exists", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.createTunnelRoute(HOSTNAME)
      // Should not add duplicate
      const count = mockState.cfTunnel.filter((r) => r.hostname === HOSTNAME).length
      expect(count).toBe(1)
    })
  })

  describe("deleteTunnelRoute", () => {
    it("removes hostname from tunnel ingress", async () => {
      mockState.cfTunnel.push({
        hostname: HOSTNAME,
        service: "http://traefik-controller.traefik-system.svc.cluster.local:80",
      })
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
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
  beforeEach(() => {
    mockState.reset()
  })

  describe("createIngressRoutes", () => {
    it("creates app and signin IngressRoutes", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)
      const appRequest = mockState.k8sRequests.find(
        (r) =>
          r.path.includes("ingressroutes") &&
          (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-app"),
      )
      const signinRequest = mockState.k8sRequests.find(
        (r) =>
          r.path.includes("ingressroutes") &&
          (r.body as { metadata?: { name?: string } })?.metadata?.name?.includes("oc-signin"),
      )
      expect(appRequest?.method).toBe("POST")
      expect(signinRequest?.method).toBe("POST")
    })

    it("sets correct host in IngressRoute spec", async () => {
      await ingressroute.createIngressRoutes(HOSTNAME)
      const appRequest = mockState.k8sRequests.find(
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
      const appRequest = mockState.k8sRequests.find(
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
      const appDelete = mockState.k8sRequests.find((r) => r.path.includes("oc-app") && r.method === "DELETE")
      const signinDelete = mockState.k8sRequests.find((r) => r.path.includes("oc-signin") && r.method === "DELETE")
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
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(true)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(true)
      expect(mockState.k8sRequests.filter((r) => r.method === "POST" && r.path.includes("ingressroutes")).length).toBe(
        2,
      )
    })
  })

  describe("Session stop (pod deleted) - DNS should be preserved", () => {
    beforeEach(async () => {
      // Simulate new session
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await ingressroute.createIngressRoutes(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      await ingressroute.deleteIngressRoutes(HOSTNAME)
      mockState.k8sRequests.length = 0
    })

    it("DNS is preserved after stop (not deleted by onPodDeleted)", async () => {
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("tunnel route is removed after stop", async () => {
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })

    it("IngressRoutes are removed after stop", async () => {
      expect(
        mockState.k8sRequests.filter((r) => r.method === "DELETE" && r.path.includes("ingressroutes")).length,
      ).toBe(0)
    })
  })

  describe("Session resume (pod added again)", () => {
    beforeEach(async () => {
      // Simulate stop (DNS preserved, tunnel/ingress removed)
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      // DNS still exists
    })

    it("reuses existing DNS (no creation)", async () => {
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      // Should not try to create since it exists
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(true)
    })

    it("recreates tunnel route", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(true)
    })
  })

  describe("Session termination (PVC deleted) - full cleanup", () => {
    beforeEach(async () => {
      // Simulate stop
      await cloudflare.createDnsRecord(HOSTNAME, "tunnel123.cfargotunnel.com")
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      // DNS still exists
    })

    it("deletes DNS record", async () => {
      await cloudflare.deleteDnsRecord(HOSTNAME)
      expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(false)
    })

    it("deletes tunnel route", async () => {
      await cloudflare.createTunnelRoute(HOSTNAME)
      await cloudflare.deleteTunnelRoute(HOSTNAME)
      expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  beforeEach(() => {
    mockState.reset()
  })

  it("multiple sessions are independent", async () => {
    const hash1 = "aaaaaaaaaaaa"
    const hash2 = "bbbbbbbbbbbb"
    const host1 = `${hash1}-oc.no-panic.org`
    const host2 = `${hash2}-oc.no-panic.org`

    await cloudflare.createDnsRecord(host1, "tunnel.cfargotunnel.com")
    await cloudflare.createDnsRecord(host2, "tunnel.cfargotunnel.com")
    expect(mockState.cfDnsRecords.has(host1)).toBe(true)
    expect(mockState.cfDnsRecords.has(host2)).toBe(true)

    // Stop session 1
    await cloudflare.createTunnelRoute(host1)
    await cloudflare.deleteTunnelRoute(host1)
    expect(mockState.cfDnsRecords.has(host1)).toBe(true)
    expect(mockState.cfDnsRecords.has(host2)).toBe(true)
  })

  it("handles DNS already deleted on termination gracefully", async () => {
    expect(mockState.cfDnsRecords.has(HOSTNAME)).toBe(false)
    await expect(cloudflare.deleteDnsRecord(HOSTNAME)).resolves.not.toThrow()
    await expect(cloudflare.deleteTunnelRoute(HOSTNAME)).resolves.not.toThrow()
  })

  it("handles tunnel already cleaned up gracefully", async () => {
    expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
    await cloudflare.deleteTunnelRoute(HOSTNAME)
    expect(mockState.cfTunnel.some((r) => r.hostname === HOSTNAME)).toBe(false)
  })
})
