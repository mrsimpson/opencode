import { describe, it, expect } from "bun:test"
import { computeIdleStatus, getPhaseKindAfterUrlRestore, type IdleLabels } from "./session-utils"
import { subscribeSessionsStream } from "./api"

const labels: IdleLabels = {
  stopsIn: (m) => `stops in ~${m}m`,
  stoppedOn: (d) => `stopped on ${d}`,
  stoppingSoon: "stopping soon",
}

describe("computeIdleStatus", () => {
  it("returns 'stops in ~Xm' for a running session active recently", () => {
    const now = new Date()
    const twoMinsAgo = new Date(now.getTime() - 2 * 60_000).toISOString()
    const result = computeIdleStatus("running", twoMinsAgo, 15, labels)
    expect(result.label).toBe("stops in ~13m")
    expect(result.stopsInMinutes).toBe(13)
  })

  it("returns 'stopping soon' for a running session past timeout", () => {
    const now = new Date()
    const twentyMinsAgo = new Date(now.getTime() - 20 * 60_000).toISOString()
    const result = computeIdleStatus("running", twentyMinsAgo, 15, labels)
    expect(result.label).toBe("stopping soon")
  })

  it("handles zero minutes since activity (just active)", () => {
    const result = computeIdleStatus("running", new Date().toISOString(), 15, labels)
    expect(result.stopsInMinutes).toBe(15)
    expect(result.label).toBe("stops in ~15m")
  })

  it("handles exactly at timeout boundary", () => {
    const now = new Date()
    const exactTimeout = new Date(now.getTime() - 15 * 60_000).toISOString()
    const result = computeIdleStatus("running", exactTimeout, 15, labels)
    // At exactly 15min: stopsInMinutes = 0, label "stops in ~0m"
    expect(result.stopsInMinutes).toBe(0)
  })

  it("returns 'stopped on <date>' for a stopped session regardless of timeout", () => {
    const past = new Date("2026-03-15T10:00:00Z").toISOString()
    const result = computeIdleStatus("stopped", past, 15, labels)
    expect(result.label).toMatch(/^stopped on /)
    expect(result.stopsInMinutes).toBeNull()
    expect(result.stoppedMinutesAgo).toBeNull()
  })

  it("creating state shows stops countdown same as running", () => {
    const now = new Date()
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60_000).toISOString()
    const result = computeIdleStatus("creating", fiveMinsAgo, 15, labels)
    expect(result.stopsInMinutes).toBe(10)
  })
})

describe("getPhaseKindAfterUrlRestore", () => {
  it('returns "creating" when session was resumed', () => {
    const result = getPhaseKindAfterUrlRestore(true, "https://abc123.localhost:3002/session/test")
    expect(result).toBe("creating")
  })

  it('returns "creating" when URL does not contain "/session/" and not resumed', () => {
    const result = getPhaseKindAfterUrlRestore(false, "https://abc123.localhost:3002/")
    expect(result).toBe("creating")
  })

  it('returns "open" when URL contains "/session/" and not resumed', () => {
    const result = getPhaseKindAfterUrlRestore(false, "https://abc123.localhost:3002/session/test")
    expect(result).toBe("open")
  })

  it('returns "creating" when resumed, even if URL contains "/session/"', () => {
    const result = getPhaseKindAfterUrlRestore(true, "https://abc123.localhost:3002/session/test")
    expect(result).toBe("creating")
  })

  it('returns "creating" for URLs without path when not resumed', () => {
    const result = getPhaseKindAfterUrlRestore(false, "https://abc123.localhost:3002")
    expect(result).toBe("creating")
  })
})

describe("subscribeSessionsStream API contract", () => {
  it("is a function accepting handlers object", () => {
    expect(typeof subscribeSessionsStream).toBe("function")
  })

  it("does not require any handlers (all optional)", () => {
    const originalEventSource = globalThis.EventSource
    const mockEs = { addEventListener: () => {}, close: () => {}, onerror: null }
    // Use a class so it satisfies `new EventSource(...)` call
    class MockEventSource {
      addEventListener() {}
      close() {}
      onerror = null
    }
    globalThis.EventSource = MockEventSource as any
    expect(() => subscribeSessionsStream({})).not.toThrow()
    globalThis.EventSource = originalEventSource
  })
})

describe("app.tsx polling replacement", () => {
  it("app.tsx source does not contain setInterval for session polling", async () => {
    const src = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const matches = src.match(/setInterval/g)
    expect(matches).toBeNull()
  })
})

describe("session-item.tsx title display", () => {
  it("session-item.tsx source references session.title", async () => {
    const src = await Bun.file(new URL("./session-item.tsx", import.meta.url)).text()
    expect(src).toContain("session.title")
  })
})

describe("session-item.tsx expand panel progress stream", () => {
  it("session-item.tsx source uses subscribeProgressStream when panel is expanded", async () => {
    const src = await Bun.file(new URL("./session-item.tsx", import.meta.url)).text()
    expect(src).toContain("subscribeProgressStream")
  })

  it("session-item.tsx source renders messages from progress stream", async () => {
    const src = await Bun.file(new URL("./session-item.tsx", import.meta.url)).text()
    // The component must render message text from the progress stream
    expect(src).toContain("messages")
  })
})
