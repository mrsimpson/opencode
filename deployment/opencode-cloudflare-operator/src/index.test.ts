import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock the k8s modules before imports
vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: class {
    loadFromCluster() {}
    loadFromDefault() {}
    makeApiClient() {
      return {}
    }
  },
  Watch: class {
    watch() {
      return Promise.resolve()
    }
  },
  CustomObjectsApi: class {},
  CoreV1Api: class {},
}))

// Set up environment before importing config
process.env.CF_API_TOKEN = "test-token"
process.env.CF_ZONE_ID = "test-zone"
process.env.CF_TUNNEL_ID = "test-tunnel"
process.env.DOMAIN = "no-panic.org"
process.env.ROUTE_SUFFIX = "-oc"
process.env.ROUTER_SERVICE_URL = "http://opencode-router:80"
process.env.WATCH_NAMESPACE = "opencode-router"
process.env.OAUTH2_CHAIN_MIDDLEWARE = "opencode-router-oauth2-chain"
process.env.ROUTER_SERVICE_NAME = "opencode-router"
process.env.OPENCODE_PORT = "4096"

describe("pollPodPorts", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it("returns ports from /api/ports endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ports: [3000, 5173, 8000] }),
    } as Response)

    const { pollPodPorts } = await import("./index.js")
    const ports = await pollPodPorts("10.0.0.1")
    expect(ports).toEqual([3000, 5173, 8000])
    expect(fetchMock).toHaveBeenCalledWith("http://10.0.0.1:4096/api/ports")
  })

  it("returns empty array when fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network error"))

    const { pollPodPorts } = await import("./index.js")
    const ports = await pollPodPorts("10.0.0.1")
    expect(ports).toEqual([])
  })

  it("returns empty array when response is not ok", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
    } as Response)

    const { pollPodPorts } = await import("./index.js")
    const ports = await pollPodPorts("10.0.0.1")
    expect(ports).toEqual([])
  })

  it("returns empty array when response has no ports", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    const { pollPodPorts } = await import("./index.js")
    const ports = await pollPodPorts("10.0.0.1")
    expect(ports).toEqual([])
  })
})

describe("sessionPortHostname", () => {
  it("generates hostname with port prefix", async () => {
    const { sessionPortHostname } = await import("./config.js")
    expect(sessionPortHostname("abc123def456", 5173)).toBe("5173-abc123def456-oc.no-panic.org")
  })

  it("generates hostname for port 3000", async () => {
    const { sessionPortHostname } = await import("./config.js")
    expect(sessionPortHostname("abc123def456", 3000)).toBe("3000-abc123def456-oc.no-panic.org")
  })

  it("generates hostname for port 8000", async () => {
    const { sessionPortHostname } = await import("./config.js")
    expect(sessionPortHostname("abc123def456", 8000)).toBe("8000-abc123def456-oc.no-panic.org")
  })
})

describe("sessionHostname", () => {
  it("generates basic session hostname", async () => {
    const { sessionHostname } = await import("./config.js")
    expect(sessionHostname("abc123def456")).toBe("abc123def456-oc.no-panic.org")
  })
})
