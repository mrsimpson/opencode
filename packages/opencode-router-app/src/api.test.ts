import { describe, it, expect, mock, beforeEach } from "bun:test"
import { terminateSession, resumeSession, suggestBranch, type Session } from "./api"

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
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/suggest-branch?repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo")
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
