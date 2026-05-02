import { describe, it, expect, mock, beforeEach } from "bun:test"
import {
  terminateSession,
  resumeSession,
  suggestBranch,
  subscribeSessionsStream,
  subscribeProgressStream,
  type Session,
} from "./api"

const fetchMock = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
global.fetch = fetchMock as any

beforeEach(() => {
  fetchMock.mockClear()
})

describe("terminateSession", () => {
  it("sends DELETE to /api/sessions/:hash", async () => {
    await terminateSession("abc123456789")
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc123456789", {
      method: "DELETE",
      signal: expect.any(AbortSignal),
    })
  })

  it("throws on non-ok response", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    await expect(terminateSession("abc123456789")).rejects.toThrow()
  })
})

describe("resumeSession", () => {
  it("sends POST to /api/sessions/:hash/resume", async () => {
    await resumeSession("abc123456789")
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/abc123456789/resume", {
      method: "POST",
      signal: expect.any(AbortSignal),
    })
  })

  it("throws on non-ok response", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    await expect(resumeSession("abc123456789")).rejects.toThrow()
  })
})

describe("suggestBranch", () => {
  it("sends GET to /api/sessions/suggest-branch?repoUrl=... and returns branch", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ branch: "feature/my-branch" }),
      }),
    )
    const result = await suggestBranch("https://github.com/org/repo")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo",
      { signal: expect.any(AbortSignal) },
    )
    expect(result).toEqual({ branch: "feature/my-branch" })
  })

  it("throws on non-ok response", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) }))
    await expect(suggestBranch("https://github.com/org/repo")).rejects.toThrow()
  })
})

describe("Session type", () => {
  it("accepts stopped as a valid state (compile-time check via assignment)", () => {
    const s: Session = {
      hash: "abc",
      email: "u@example.com",
      repoUrl: "https://github.com/org/repo",
      branch: "calm-snails-dream",
      sourceBranch: "main",
      state: "stopped",
      url: "https://example.com",
      lastActivity: "2026-04-13T00:00:00Z",
      createdAt: "2026-04-13T00:00:00Z",
      idleTimeoutMinutes: 30,
    }
    expect(s.state).toBe("stopped")
  })

  it("has lastActivity and idleTimeoutMinutes fields", () => {
    const s: Session = {
      hash: "xyz",
      email: "u@example.com",
      repoUrl: "https://github.com/org/repo",
      branch: "brave-tigers-run",
      sourceBranch: "dev",
      state: "running",
      url: "https://example.com",
      lastActivity: "2026-04-13T12:00:00Z",
      createdAt: "2026-04-13T12:00:00Z",
      idleTimeoutMinutes: 60,
    }
    expect(typeof s.lastActivity).toBe("string")
    expect(typeof s.idleTimeoutMinutes).toBe("number")
  })
})

// ---------------------------------------------------------------------------
// Session interface includes title
// ---------------------------------------------------------------------------
describe("Session interface includes title", () => {
  it("Session objects with title are accepted", () => {
    const session: Session = {
      hash: "abc123456789",
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "main",
      sourceBranch: "main",
      state: "running",
      url: "https://abc123456789.test.local",
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      idleTimeoutMinutes: 30,
      title: "My session title",
    }
    expect(session.title).toBe("My session title")
  })

  it("Session objects without title are also valid (title is optional)", () => {
    const session: Session = {
      hash: "abc123456789",
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "main",
      sourceBranch: "main",
      state: "running",
      url: "https://abc123456789.test.local",
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      idleTimeoutMinutes: 30,
    }
    expect(session.title).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// subscribeSessionsStream — SSE subscription
// ---------------------------------------------------------------------------
describe("subscribeSessionsStream", () => {
  it("is exported from api.ts", () => {
    expect(typeof subscribeSessionsStream).toBe("function")
  })

  it("returns an EventSource connected to /api/sessions/stream", () => {
    // Mock EventSource globally
    const originalEventSource = globalThis.EventSource
    const mockEs = {
      close: mock(() => {}),
      addEventListener: mock((_event: string, _handler: Function) => {}),
      url: "/api/sessions/stream",
      readyState: 0,
    }
    globalThis.EventSource = mock(() => mockEs) as any

    const es = subscribeSessionsStream({})
    expect(globalThis.EventSource as any).toHaveBeenCalledWith("/api/sessions/stream")

    globalThis.EventSource = originalEventSource
  })

  it("calls onSessions handler when sessions event fires", () => {
    // We test the handler wiring by checking if addEventListener is called with "sessions"
    const originalEventSource = globalThis.EventSource
    const listeners: Record<string, Function> = {}
    const mockEs = {
      close: mock(() => {}),
      addEventListener: mock((event: string, handler: Function) => {
        listeners[event] = handler
      }),
      url: "/api/sessions/stream",
    }
    globalThis.EventSource = mock(() => mockEs) as any

    const onSessions = mock((_data: object) => {})
    subscribeSessionsStream({ onSessions })

    // Simulate the "sessions" event
    const payload = { email: "user@test.com", sessions: [] }
    listeners["sessions"]?.({ data: JSON.stringify(payload) })

    expect(onSessions).toHaveBeenCalledTimes(1)
    expect((onSessions as any).mock.calls[0][0]).toEqual(payload)

    globalThis.EventSource = originalEventSource
  })
})

// ---------------------------------------------------------------------------
// subscribeProgressStream — SSE subscription for progress
// ---------------------------------------------------------------------------
describe("subscribeProgressStream", () => {
  it("is exported from api.ts", () => {
    expect(typeof subscribeProgressStream).toBe("function")
  })

  it("returns an EventSource connected to /api/sessions/:hash/progress/stream", () => {
    const originalEventSource = globalThis.EventSource
    const mockEs = {
      close: mock(() => {}),
      addEventListener: mock((_event: string, _handler: Function) => {}),
    }
    globalThis.EventSource = mock(() => mockEs) as any

    subscribeProgressStream("abc123456789", {})
    expect(globalThis.EventSource as any).toHaveBeenCalledWith("/api/sessions/abc123456789/progress/stream")

    globalThis.EventSource = originalEventSource
  })

  it("calls onSnapshot handler when snapshot event fires", () => {
    const originalEventSource = globalThis.EventSource
    const listeners: Record<string, Function> = {}
    const mockEs = {
      close: mock(() => {}),
      addEventListener: mock((event: string, handler: Function) => {
        listeners[event] = handler
      }),
    }
    globalThis.EventSource = mock(() => mockEs) as any

    const onSnapshot = mock((_progress: object) => {})
    subscribeProgressStream("abc123456789", { onSnapshot })

    const payload = { title: "Test", messages: [] }
    listeners["snapshot"]?.({ data: JSON.stringify(payload) })

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect((onSnapshot as any).mock.calls[0][0]).toEqual(payload)

    globalThis.EventSource = originalEventSource
  })

  it("calls onMessage handler when message event fires", () => {
    const originalEventSource = globalThis.EventSource
    const listeners: Record<string, Function> = {}
    const mockEs = {
      close: mock(() => {}),
      addEventListener: mock((event: string, handler: Function) => {
        listeners[event] = handler
      }),
    }
    globalThis.EventSource = mock(() => mockEs) as any

    const onMessage = mock((_msg: object) => {})
    subscribeProgressStream("abc123456789", { onMessage })

    const msg = { partID: "p1", messageID: "m1", sessionID: "s1", role: "user", text: "hi", time: 1000 }
    listeners["message"]?.({ data: JSON.stringify(msg) })

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect((onMessage as any).mock.calls[0][0]).toEqual(msg)

    globalThis.EventSource = originalEventSource
  })
})
