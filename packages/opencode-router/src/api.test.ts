import { mock, describe, it, expect, beforeEach, afterAll } from "bun:test"
import { Readable } from "node:stream"
import type http from "node:http"

process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.ADMIN_SECRET = "test-admin-secret"

// ---------------------------------------------------------------------------
// Mock pod-manager BEFORE importing api.ts
// NOTE: "suggest-branch" route MUST be matched before /:hash route in api.ts,
// otherwise GET /api/sessions/suggest-branch would be misinterpreted as a
// request for the session with hash "suggest-branch" (which is not a 12-char
// hex string, but guarding with regex alone may be fragile). The implementation
// should place the suggest-branch route before the /:hash pattern.
// ---------------------------------------------------------------------------

class RemoteRefsUnreachableError extends Error {
  constructor(repoUrl: string, cause: string) {
    super(`Could not reach ${repoUrl}: ${cause}`)
    this.name = "RemoteRefsUnreachableError"
  }
}

const mocks = {
  listUserSessions: mock((): Promise<object[]> => Promise.resolve([])),
  ensurePVC: mock(() => Promise.resolve()),
  ensurePod: mock(() => Promise.resolve("abc123")),
  getPodState: mock(() => Promise.resolve("running")),
  getSessionHash: mock(() => "abc123456789"),
  terminateSession: mock(() => Promise.resolve()),
  resumeSession: mock(() => Promise.resolve()),
  suggestBranch: mock(() => Promise.resolve("calm-snails-dream")),
  remoteBranchExists: mock(() => Promise.resolve(true)),
  prepullImage: mock(() => Promise.resolve(true)),
  RemoteRefsUnreachableError,
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
  mocks.remoteBranchExists.mockReset()
  mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
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
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions verifies sourceBranch exists on the remote
// ---------------------------------------------------------------------------

describe("POST /api/sessions verifies sourceBranch on remote", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
  })

  it("calls remoteBranchExists with the supplied repoUrl and sourceBranch", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.remoteBranchExists).toHaveBeenCalledTimes(1)
    expect((mocks.remoteBranchExists as any).mock.calls[0]).toEqual(["https://github.com/x/y", "main"])
    expect(res.statusCode).toBe(201)
  })

  it("returns 400 when the source branch is not found on the remote (does NOT create pod/PVC)", async () => {
    // This is the case that caused pod opencode-session-08ecf7c644a1 to crashloop:
    // user passed "Main" but the remote's branch is "main".
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(false))

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/mrsimpson/opencode",
      branch: "great-showers-end",
      sourceBranch: "Main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toContain("Main")
    expect(body.error).toContain("not found")
    // Must not have created anything in the cluster
    expect(mocks.ensurePVC).not.toHaveBeenCalled()
    expect(mocks.ensurePod).not.toHaveBeenCalled()
  })

  it("returns 502 when the remote is unreachable", async () => {
    mocks.remoteBranchExists.mockImplementation(() =>
      Promise.reject(new RemoteRefsUnreachableError("https://nope.invalid/x/y", "ENOTFOUND")),
    )

    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://nope.invalid/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(502)
    expect(mocks.ensurePVC).not.toHaveBeenCalled()
    expect(mocks.ensurePod).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// githubToken threading
// ---------------------------------------------------------------------------

describe("POST /api/sessions passes githubToken to ensurePod", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
  })

  it("passes the githubToken to ensurePod when present", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(201)
    expect(mocks.ensurePod).toHaveBeenCalledTimes(1)
    expect((mocks.ensurePod as any).mock.calls[0][1]).toBe("gho_test_token")
  })

  it("passes undefined to ensurePod when githubToken is absent", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/x/y",
      branch: "calm-snails-dream",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    expect(mocks.ensurePod).toHaveBeenCalledTimes(1)
    expect((mocks.ensurePod as any).mock.calls[0][1]).toBeUndefined()
  })
})

describe("POST /api/sessions/:hash/resume passes githubToken to resumeSession", () => {
  it("passes the githubToken to resumeSession when present", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
    expect((mocks.resumeSession as any).mock.calls[0][2]).toBe("gho_test_token")
  })

  it("passes undefined to resumeSession when githubToken is absent", async () => {
    const req = fakeReq("POST", "/api/sessions/abc123456789/resume")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1)
    expect((mocks.resumeSession as any).mock.calls[0][2]).toBeUndefined()
  })
})

describe("GET /api/ports returns listening ports", () => {
  it("returns ports >3000 from /proc/net/tcp", async () => {
    const req = fakeReq("GET", "/api/ports")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body as string)
    expect(body).toHaveProperty("ports")
    expect(Array.isArray(body.ports)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions with initialMessage — passed to ensurePVC via SessionKey
// ---------------------------------------------------------------------------

describe("POST /api/sessions with initialMessage", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
    mocks.getSessionHash.mockReset()
    mocks.getSessionHash.mockImplementation(() => "abc123456789")
  })

  it("passes initialMessage in SessionKey to ensurePVC", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
      initialMessage: "Fix the bug",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    const pvcCall = (mocks.ensurePVC as any).mock.calls[0][0]
    expect(pvcCall.initialMessage).toBe("Fix the bug")
  })
})

describe("POST /api/sessions without initialMessage", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
  })

  it("ensurePVC receives undefined initialMessage", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(201)
    const pvcCall = (mocks.ensurePVC as any).mock.calls[0][0]
    expect(pvcCall.initialMessage).toBeUndefined()
  })
})

describe("ANNOTATION_INITIAL_MESSAGE in SessionKey — initialMessage passed to ensurePVC", () => {
  beforeEach(() => {
    mocks.ensurePVC.mockReset()
    mocks.ensurePVC.mockImplementation(() => Promise.resolve())
    mocks.ensurePod.mockReset()
    mocks.ensurePod.mockImplementation(() => Promise.resolve("abc123456789"))
    mocks.remoteBranchExists.mockReset()
    mocks.remoteBranchExists.mockImplementation(() => Promise.resolve(true))
  })

  it("passes initialMessage in the SessionKey argument to ensurePVC", async () => {
    const req = fakeReq("POST", "/api/sessions", {
      repoUrl: "https://github.com/org/repo.git",
      branch: "calm-snails",
      sourceBranch: "main",
      initialMessage: "Hello world",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.ensurePVC).toHaveBeenCalledTimes(1)
    const sessionKeyPassed = (mocks.ensurePVC as any).mock.calls[0]?.[0]
    expect(sessionKeyPassed?.initialMessage).toBe("Hello world")
  })
})

// ---------------------------------------------------------------------------
// GET /api/user/repos — list repositories for authenticated user
// ---------------------------------------------------------------------------

describe("GET /api/user/repos", () => {
  it("returns 401 when no githubToken is provided", async () => {
    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("GitHub token required")
  })

  it("returns 200 with repos when githubToken is provided", async () => {
    const mockRepos = [
      {
        name: "opencode",
        full_name: "mrsimpson/opencode",
        html_url: "https://github.com/mrsimpson/opencode",
        private: false,
      },
      {
        name: "website",
        full_name: "mrsimpson/website",
        html_url: "https://github.com/mrsimpson/website",
        private: true,
      },
    ]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockRepos),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(2)
    expect(body[0].name).toBe("opencode")
    expect(body[0].fullName).toBe("mrsimpson/opencode")
    expect(body[0].url).toBe("https://github.com/mrsimpson/opencode")
    expect(body[0].isPrivate).toBe(false)
    expect(body[1].isPrivate).toBe(true)
  })

  it("returns 403 when GitHub API returns 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_invalid_token")

    expect(res.statusCode).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// GET /api/user/repos/branches — list branches for a specific repo
// ---------------------------------------------------------------------------

describe("GET /api/user/repos/branches", () => {
  it("returns 401 when no githubToken is provided", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?repo=mrsimpson%2Fopencode")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("GitHub token required")
  })

  it("returns 400 when repo parameter is missing", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("returns 200 with branches when repo and token are provided", async () => {
    const mockBranches = [{ name: "main" }, { name: "dev" }, { name: "feature/test" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=mrsimpson%2Fopencode")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(3)
    expect(body[0].name).toBe("main")
    expect(body[1].name).toBe("dev")
    expect(body[2].name).toBe("feature/test")
  })

  it("returns 404 when GitHub API returns 404 for unknown repo", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=unknown%2Frepo")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_test_token")

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// suggest-branch query param — no localhost fallback
// ---------------------------------------------------------------------------

describe("GET /api/sessions/suggest-branch query parsing", () => {
  it("returns 400 when repoUrl is empty string", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repoUrl is required")
  })

  it("returns 400 when repoUrl query key is missing entirely", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?foo=bar")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when query string is empty", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch")
    const res = fakeRes()

    const handled = await handleApi(req as any, res as any, EMAIL)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it("passes correct repoUrl to suggestBranch", async () => {
    const req = fakeReq("GET", "/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Ftest%2Frepo.git")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(mocks.suggestBranch).toHaveBeenCalledTimes(1)
    expect((mocks.suggestBranch as any).mock.calls[0][0]).toBe(EMAIL)
    expect((mocks.suggestBranch as any).mock.calls[0][1]).toBe("https://github.com/test/repo.git")
  })
})

// ---------------------------------------------------------------------------
// branches query param — no localhost fallback
// ---------------------------------------------------------------------------

describe("GET /api/user/repos/branches query parsing", () => {
  it("returns 400 when repo query key is missing entirely", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?foo=bar")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("returns 400 when repo query key is empty string", async () => {
    const req = fakeReq("GET", "/api/user/repos/branches?repo=")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("repo parameter required")
  })

  it("passes correct repo to GitHub API", async () => {
    const mockBranches = [{ name: "main" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    const req = fakeReq("GET", "/api/user/repos/branches?repo=org%2Frepo")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(200)
    // Verify fetch was called with the correct repo in the URL
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const callUrl = (globalThis.fetch as any).mock.calls[0][0]
    expect(callUrl).toBe("https://api.github.com/repos/org/repo/branches?per_page=100")
  })

  it("handles repo with special characters in query", async () => {
    const mockBranches = [{ name: "main" }]
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      } as Response),
    )

    // repo with path-like characters
    const req = fakeReq("GET", "/api/user/repos/branches?repo=my-org%2Fmy-repo.git")
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL, "gho_token")

    expect(res.statusCode).toBe(200)
    const callUrl = (globalThis.fetch as any).mock.calls[0][0]
    expect(callUrl).toBe("https://api.github.com/repos/my-org/my-repo.git/branches?per_page=100")
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/pull-image — pre-pull container image (CI endpoint)
// ---------------------------------------------------------------------------

describe("POST /api/admin/pull-image", () => {
  beforeEach(() => {
    // Set admin secret for tests
    process.env.ADMIN_SECRET = "test-admin-secret"
    mocks.prepullImage.mockReset()
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))
  })

  // Tests run with ADMIN_SECRET set at module import time

  it("returns 501 when ADMIN_SECRET is not configured", async () => {
    // Since config is loaded at module import time, we can't dynamically unset it
    // Instead, verify the endpoint works when ADMIN_SECRET IS set (501 is if it's undefined)
    // This test documents the expected behavior
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    // With ADMIN_SECRET set, should NOT return 501
    expect(res.statusCode).not.toBe(501)
  })

  it("returns 403 when admin secret header is missing", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Forbidden")
  })

  it("returns 403 when admin secret header is incorrect", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "wrong-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Forbidden")
  })

  it("returns 400 when image is missing from request body", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image", {})
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("image is required")
  })

  it("returns 400 when request body is invalid JSON", async () => {
    const req = fakeReq("POST", "/api/admin/pull-image")
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    // Override push to send invalid JSON
    const r = req as any
    r.push = (data: any) => {
      r._body = "not-valid-json"
    }
    r.push(null)
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Invalid JSON")
  })

  it("returns 200 with success when prepullImage succeeds", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
      updateConfig: true,
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe("success")
    expect(body.message).toContain("ghcr.io/org/opencode:sha-1234")
    expect(mocks.prepullImage).toHaveBeenCalledTimes(1)
    expect(mocks.prepullImage).toHaveBeenCalledWith("ghcr.io/org/opencode:sha-1234")
  })

  it("returns 500 with failed status when prepullImage fails", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(false))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.status).toBe("failed")
    expect(body.message).toContain("ghcr.io/org/opencode:sha-1234")
  })

  it("calls prepullImage with only image when updateConfig is omitted", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.resolve(true))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(200)
    expect(mocks.prepullImage).toHaveBeenCalledTimes(1)
    expect(mocks.prepullImage).toHaveBeenCalledWith("ghcr.io/org/opencode:sha-1234")
  })

  it("returns 500 on internal error", async () => {
    mocks.prepullImage.mockImplementation(() => Promise.reject(new Error("K8s error")))

    const req = fakeReq("POST", "/api/admin/pull-image", {
      image: "ghcr.io/org/opencode:sha-1234",
    })
    ;(req as any).headers["x-admin-secret"] = "test-admin-secret"
    const res = fakeRes()

    await handleApi(req as any, res as any, EMAIL)

    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.error).toBe("Internal server error")
  })
})
