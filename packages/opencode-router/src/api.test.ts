import { mock, describe, it, expect, beforeEach } from "bun:test"
import { Readable } from "node:stream"
import type http from "node:http"

process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"

// ---------------------------------------------------------------------------
// Mock pod-manager BEFORE importing api.ts
// NOTE: "suggest-branch" route MUST be matched before /:hash route in api.ts,
// otherwise GET /api/sessions/suggest-branch would be misinterpreted as a
// request for the session with hash "suggest-branch" (which is not a 12-char
// hex string, but guarding with regex alone may be fragile). The implementation
// should place the suggest-branch route before the /:hash pattern.
// ---------------------------------------------------------------------------

const mocks = {
  listUserSessions: mock((): Promise<object[]> => Promise.resolve([])),
  ensurePVC: mock(() => Promise.resolve()),
  ensurePod: mock(() => Promise.resolve("abc123")),
  getPodState: mock(() => Promise.resolve("running")),
  getSessionHash: mock(() => "abc123456789"),
  terminateSession: mock(() => Promise.resolve()),
  resumeSession: mock(() => Promise.resolve()),
  suggestBranch: mock(() => Promise.resolve("calm-snails-dream")),
}

mock.module("./pod-manager.js", () => mocks)

const { handleApi } = await import("./api.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReq(method: string, url: string, body?: object): http.IncomingMessage {
  const r = new Readable() as any
  r.method = method
  r.url = url
  r.headers = { "x-forwarded-proto": "https" }
  if (body) {
    r.push(JSON.stringify(body))
    r.push(null)
  } else {
    r.push(null)
  }
  return r
}

function fakeRes(): {
  statusCode: number
  body: string
  headers: Record<string, string>
  writeHead: Function
  end: Function
} {
  const r: any = { statusCode: 200, body: "", headers: {} }
  r.writeHead = (status: number, headers?: object) => {
    r.statusCode = status
    Object.assign(r.headers, headers ?? {})
    return r
  }
  r.end = (data?: string) => {
    r.body = data ?? ""
  }
  return r
}

const EMAIL = "user@example.com"

beforeEach(() => {
  mocks.listUserSessions.mockReset()
  mocks.listUserSessions.mockImplementation(() => Promise.resolve([]))
  mocks.terminateSession.mockReset()
  mocks.terminateSession.mockImplementation(() => Promise.resolve())
  mocks.resumeSession.mockReset()
  mocks.resumeSession.mockImplementation(() => Promise.resolve())
  mocks.suggestBranch.mockReset()
  mocks.suggestBranch.mockImplementation(() => Promise.resolve("calm-snails-dream"))
  mocks.getPodState.mockReset()
  mocks.getPodState.mockImplementation(() => Promise.resolve("running"))
})

// ---------------------------------------------------------------------------
// 1.3.6: DELETE /api/sessions/:hash
// ---------------------------------------------------------------------------

describe("DELETE /api/sessions/:hash", () => {
  it("returns 204 on successful termination", async () => {
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(204)
    expect(mocks.terminateSession).toHaveBeenCalledTimes(1)
  })

  it("returns 403 when terminateSession throws Forbidden", async () => {
    mocks.terminateSession.mockImplementation(() => Promise.reject(new Error("Forbidden")))
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })

  it("returns 404 when terminateSession throws NotFound", async () => {
    mocks.terminateSession.mockImplementation(() => Promise.reject(new Error("NotFound")))
    const req = fakeReq("DELETE", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
  })

  it("returns false (not handled) for DELETE on /api/sessions (no hash)", async () => {
    const req = fakeReq("DELETE", "/api/sessions")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 1.3.7: POST /api/sessions/:hash/resume
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:hash/resume", () => {
  it("returns 200 with state creating after resuming", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.state).toBe("creating")
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
  })

  it("returns 403 when resumeSession throws Forbidden", async () => {
    mocks.resumeSession.mockImplementation(() => Promise.reject(new Error("Forbidden")))
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
  })

  it("returns 404 when resumeSession throws NotFound", async () => {
    mocks.resumeSession.mockImplementation(() => Promise.reject(new Error("NotFound")))
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 1.3.8: GET /api/sessions/suggest-branch?repoUrl=
// ---------------------------------------------------------------------------

describe("GET /api/sessions/suggest-branch", () => {
  it("returns 200 with branch field when repoUrl is provided", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Fx%2Fy")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(typeof body.branch).toBe("string")
    expect(body.branch).toBe("calm-snails-dream")
    expect(mocks.suggestBranch).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when repoUrl is missing", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(typeof body.error).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// 1.3.9: lastActivity + idleTimeoutMinutes in session list and get
// ---------------------------------------------------------------------------

describe("GET /api/sessions (list) includes lastActivity", () => {
  it("session list response contains lastActivity and idleTimeoutMinutes per session", async () => {
    const sessions: object[] = [
      {
        hash: "abc123456789",
        email: EMAIL,
        repoUrl: "https://github.com/x/y",
        branch: "main",
        state: "running",
        url: "https://abc123456789.opencode.test.local",
        lastActivity: "2025-06-01T12:00:00Z",
        idleTimeoutMinutes: 30,
      },
    ]
    mocks.listUserSessions.mockImplementation(() => Promise.resolve(sessions))

    const req = fakeReq("GET", "/api/sessions")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.sessions).toHaveLength(1)
    expect(typeof body.sessions[0].lastActivity).toBe("string")
    expect(typeof body.sessions[0].idleTimeoutMinutes).toBe("number")
  })
})

describe("GET /api/sessions/:hash includes lastActivity", () => {
  it("single session response includes lastActivity and idleTimeoutMinutes", async () => {
    // Current implementation calls getPodState which only returns state —
    // the new implementation must call getSessionState or a richer lookup.
    // This test will FAIL because the current GET /api/sessions/:hash returns
    // { hash, state, url } with no lastActivity or idleTimeoutMinutes.
    mocks.getPodState.mockImplementation(() => Promise.resolve("running"))

    const req = fakeReq("GET", "/api/sessions/abc123456789")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.hash).toBe("abc123456789")
    // These assertions WILL FAIL until the implementation is updated:
    expect(typeof body.lastActivity).toBe("string")
    expect(typeof body.idleTimeoutMinutes).toBe("number")
  })
})

// ---------------------------------------------------------------------------
// 1.3.14: POST /api/sessions passes sourceBranch to ensurePod/ensurePVC
// ---------------------------------------------------------------------------

describe("POST /api/sessions with sourceBranch", () => {
  it("accepts sourceBranch in request body and passes it through", async () => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(201)
    // WILL FAIL until api.ts reads sourceBranch from body and passes to SessionKey
    const sessionKeyPassed = (mocks.ensurePVC as any).mock.calls[0]?.[0]
    expect(sessionKeyPassed?.sourceBranch).toBe("main")
  })

  it("returns 400 when sourceBranch is missing", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      // sourceBranch intentionally omitted
    })
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    // WILL FAIL: current impl doesn't require sourceBranch
    expect(res.statusCode).toBe(400)
  })
})
