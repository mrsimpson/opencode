import { describe, it, expect, mock, beforeEach } from "bun:test"

// Test the plugin module exports the right shape
describe("opencode-router-plugin exports", () => {
  it("exports a default object with id and server fields", async () => {
    const mod = await import("./index.js")
    expect(typeof mod.default).toBe("object")
    expect(mod.default.id).toBe("opencode-router")
    expect(typeof mod.default.server).toBe("function")
  })
})

// Test the push helper
describe("pushEvent", () => {
  it("POSTs to the router with correct headers", async () => {
    // Set env vars that the plugin reads
    process.env.OPENCODE_ROUTER_URL = "http://router.test"
    process.env.OPENCODE_SESSION_HASH = "abc123456789"
    process.env.OPENCODE_POD_SECRET = "mysecret"

    // Import inline to avoid hoisting issues
    const { pushEvent } = await import("./plugin.js")

    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    const mockFetch = mock((url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve({ ok: true } as Response)
    })
    globalThis.fetch = mockFetch as any

    await pushEvent({ type: "session.title", sessionID: "sess-1", title: "My Title" })

    expect(capturedUrl).toBe("http://router.test/api/sessions/abc123456789/progress")
    expect((capturedInit?.headers as Record<string, string>)?.["x-pod-secret"]).toBe("mysecret")
    expect((capturedInit?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json")
    const body = JSON.parse(capturedInit?.body as string)
    expect(body.type).toBe("session.title")
    expect(body.title).toBe("My Title")
  })

  it("does nothing when OPENCODE_ROUTER_URL is not set", async () => {
    delete process.env.OPENCODE_ROUTER_URL
    const { pushEvent } = await import("./plugin.js")
    const mockFetch = mock(() => Promise.resolve({ ok: true } as Response))
    globalThis.fetch = mockFetch as any

    await pushEvent({ type: "session.title", sessionID: "sess-1", title: "Test" })

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
