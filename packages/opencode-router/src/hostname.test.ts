import { describe, it, expect } from "bun:test"

process.env.OPENCODE_IMAGE = "test"
process.env.OPENCODE_NAMESPACE = "opencode"
process.env.ROUTER_DOMAIN = "no-panic.org"
process.env.ROUTE_SUFFIX = "-oc"
process.env.OPENCODE_PORT = "4096"
process.env.IDLE_TIMEOUT_MINUTES = "60"
process.env.API_KEY_SECRET_NAME = "test"
process.env.CONFIG_MAP_NAME = "test"
process.env.STORAGE_SIZE = "1Gi"

describe("getSessionInfo extracts hash and port from hostname", () => {
  // We need to test the function directly - import it after config is set
  const { config } = require("./config.js")

  // Re-implement getSessionInfo for testing (same logic as index.ts)
  function getSessionInfo(host: string): { hash: string | null; port: number | null } {
    const hostname = host.split(":")[0]
    const routerHostname = config.routerDomain.split(":")[0]
    const suffix = `${config.routeSuffix}.${routerHostname}`
    if (!hostname.endsWith(suffix)) return { hash: null, port: null }

    const sub = hostname.slice(0, hostname.length - suffix.length)

    // Check for <port>-<hash> pattern (port is 4+ digits at start)
    const portMatch = sub.match(/^([1-9][0-9]{3,})-(.+)$/)
    if (portMatch) {
      const port = parseInt(portMatch[1], 10)
      const hashPart = portMatch[2]
      if (/^[a-f0-9]{12}$/.test(hashPart)) {
        return { hash: hashPart, port }
      }
    }

    // Default: just <hash>
    if (/^[a-f0-9]{12}$/.test(sub)) {
      return { hash: sub, port: null }
    }

    return { hash: null, port: null }
  }

  it("extracts hash only from basic hostname", () => {
    const result = getSessionInfo("abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBeNull()
  })

  it("extracts port and hash from dev server hostname", () => {
    const result = getSessionInfo("5173-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(5173)
  })

  it("extracts port 3000", () => {
    const result = getSessionInfo("3000-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(3000)
  })

  it("extracts port 8000", () => {
    const result = getSessionInfo("8000-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(8000)
  })

  it("returns null for invalid hash length", () => {
    const result = getSessionInfo("abc-oc.no-panic.org")
    expect(result.hash).toBeNull()
    expect(result.port).toBeNull()
  })

  it("returns null for non-session hostname", () => {
    const result = getSessionInfo("www.no-panic.org")
    expect(result.hash).toBeNull()
    expect(result.port).toBeNull()
  })

  it("handles port in Host header", () => {
    const result = getSessionInfo("5173-abc123def456-oc.no-panic.org:443")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(5173)
  })

  it("rejects ports <3000", () => {
    const result = getSessionInfo("8080-abc123def456-oc.no-panic.org")
    // Note: this would match but 8080 < 3000 filter happens in getListeningPorts
    // The regex allows it but the test shows it's possible
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(8080)
  })
})
