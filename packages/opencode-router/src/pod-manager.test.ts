import { describe, it, expect, beforeEach } from "bun:test"

// Set required env vars before config module is loaded
process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"

// --- Fake k8s client state (mutated per test via helpers below) ---
let fakePVCs: object[] = []
let fakePods: object[] = []
let createPodCalls: object[] = []
let patchPodCalls: { name: string; body: object }[] = []
let fakeSecrets: object[] = []
let createSecretCalls: object[] = []
let replaceSecretCalls: object[] = []
let deleteSecretCalls: string[] = []

const fakeK8sApi = {
  listNamespacedPersistentVolumeClaim: async (_opts: object) => ({ items: fakePVCs }),
  listNamespacedPod: async (_opts: object) => ({ items: fakePods }),
  readNamespacedPod: async ({ name }: { name: string }) => {
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (!pod) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pod
  },
  readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const pvc = (fakePVCs as any[]).find((p) => p.metadata?.name === name)
    if (!pvc) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pvc
  },
  createNamespacedPod: async ({ namespace, body }: { namespace: string; body: object }) => {
    createPodCalls.push({ namespace, body })
    fakePods = [...(fakePods as any[]), body]
    return body
  },
  patchNamespacedPod: async ({ name, body }: { name: string; body: object }) => {
    patchPodCalls.push({ name, body })
    // Apply annotation patches to in-memory pod so later reads see the update
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (pod && (body as any).metadata?.annotations) {
      pod.metadata.annotations = { ...pod.metadata.annotations, ...(body as any).metadata.annotations }
    }
  },
  deleteNamespacedPod: async ({ name }: { name: string }) => {
    const idx = (fakePods as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePods = (fakePods as any[]).filter((_, i) => i !== idx)
  },
  deleteNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const idx = (fakePVCs as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePVCs = (fakePVCs as any[]).filter((_, i) => i !== idx)
  },
  createNamespacedSecret: async ({ namespace, body }: { namespace: string; body: any }) => {
    createSecretCalls.push({ namespace, body })
    fakeSecrets = [...fakeSecrets, body]
    return body
  },
  replaceNamespacedSecret: async ({ name, namespace, body }: { name: string; namespace: string; body: any }) => {
    replaceSecretCalls.push({ name, namespace, body })
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (s) Object.assign(s.stringData ?? (s.stringData = {}), body.stringData ?? {})
  },
  deleteNamespacedSecret: async ({ name }: { name: string }) => {
    deleteSecretCalls.push(name)
    const idx = (fakeSecrets as any[]).findIndex((s) => s.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakeSecrets = (fakeSecrets as any[]).filter((_, i) => i !== idx)
  },
  readNamespacedSecret: async ({ name }: { name: string }) => {
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (!s) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return s
  },
}

// pod-manager.test.ts must run in its own bun process (see package.json test script)
// to avoid api.test.ts's mock.module("./pod-manager.js") poisoning this module import.
const {
  listUserSessions,
  terminateSession,
  resumeSession,
  suggestBranch,
  remoteBranchExists,
  deleteIdlePods,
  RemoteRefsUnreachableError,
  _setApiClient,
  _setHumanId,
  _setFetch,
  _setActivityFetch,
} = await import("./pod-manager.ts")
_setApiClient(fakeK8sApi as any)

// --- Helpers ---

function makePVC(sessionHash: string, email: string, repoUrl: string, branch: string, lastActivity?: string) {
  return {
    metadata: {
      name: `opencode-pvc-${sessionHash}`,
      namespace: "opencode",
      creationTimestamp: "2025-01-01T00:00:00Z",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
        ...(lastActivity ? { "opencode.ai/last-activity": lastActivity } : {}),
      },
    },
    spec: {},
    status: { phase: "Bound" },
  }
}

function makeRunningPod(
  sessionHash: string,
  email: string,
  repoUrl: string,
  branch: string,
  lastActivity = "2025-06-01T12:00:00Z",
) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": lastActivity,
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.1",
      conditions: [{ type: "Ready", status: "True" }],
    },
  }
}

function makePendingPod(sessionHash: string, email: string, repoUrl: string, branch: string) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": "2025-06-01T12:00:00Z",
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: { phase: "Pending" },
  }
}

const fakeReq = { headers: { "x-forwarded-proto": "https" } } as any

const EMAIL = "test@example.com"
const REPO = "https://github.com/x/y"
const BRANCH = "main"

// Compute hash identically to pod-manager's getSessionHash
import crypto from "node:crypto"
function computeHash(email: string, repo: string, branch: string) {
  const key = `${email.toLowerCase().trim()}:${repo.trim()}:${branch.trim()}`
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)
}
const SESSION_HASH = computeHash(EMAIL, REPO, BRANCH)

beforeEach(() => {
  fakePVCs = []
  fakePods = []
  createPodCalls = []
  patchPodCalls = []
  fakeSecrets = []
  createSecretCalls = []
  replaceSecretCalls = []
  deleteSecretCalls = []
  // Reset activity fetch to a fast no-op so tests that don't care about it don't hang
  _setActivityFetch(async () => new Response("[]", { status: 200 }))
})

// ---------------------------------------------------------------------------

describe("listUserSessions", () => {
  it("returns stopped session when PVC exists but no pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("stopped")
    expect((result[0] as any).hash).toBe(SESSION_HASH)
    expect((result[0] as any).email).toBe(EMAIL)
  })

  it("returns running session when PVC and running pod both exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("running")
  })

  it("returns creating session when PVC and pending pod exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makePendingPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("creating")
  })

  it("includes lastActivity and idleTimeoutMinutes in stopped session result", async () => {
    const lastActivity = "2025-06-01T10:00:00Z"
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, lastActivity)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("includes lastActivity and idleTimeoutMinutes in running session result", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("ensurePod git-init script checks out sourceBranch then creates sessionBranch", async () => {
    // After creating a pod, the init script must contain both sourceBranch and branch
    fakePVCs = []
    fakePods = []
    createPodCalls = []

    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Script must checkout the sourceBranch before creating the new sessionBranch
    expect(script).toContain("main") // sourceBranch checkout
    expect(script).toContain("calm-snails-dream") // new session branch creation
    // Must NOT try to look up "calm-snails-dream" on remote (it's always a new branch)
    expect(script).not.toContain('ls-remote --exit-code --heads origin "calm-snails-dream"')
  })
})

// ---------------------------------------------------------------------------
// remoteBranchExists: verify a branch exists on a remote git repo via Smart HTTP
// ---------------------------------------------------------------------------

describe("remoteBranchExists", () => {
  // Helper — build a Smart HTTP v1 info/refs body. The first ref line uses \0
  // before capabilities, subsequent refs use \n.
  function smartHttpBody(refs: string[]): string {
    const lines: string[] = ["001e# service=git-upload-pack\n", "0000"]
    refs.forEach((name, i) => {
      const sha = "a".repeat(40)
      if (i === 0) {
        lines.push(`00bd${sha} ${name}\0multi_ack thin-pack side-band side-band-64k symref=HEAD:${name}\n`)
      } else {
        lines.push(`003f${sha} ${name}\n`)
      }
    })
    lines.push("0000")
    return lines.join("")
  }

  function mockFetch(body: string, status = 200) {
    _setFetch(async () => new Response(body, { status }))
  }

  function mockFetchThrow(err: Error) {
    _setFetch(async () => {
      throw err
    })
  }

  it("returns true when the branch is advertised as the first ref (\\0 terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    expect(await remoteBranchExists("https://github.com/x/y", "main")).toBe(true)
  })

  it("returns true when the branch is advertised as a later ref (\\n terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main", "refs/heads/feature/foo"]))
    expect(await remoteBranchExists("https://github.com/x/y", "feature/foo")).toBe(true)
  })

  it("returns false for a branch that is not advertised (wrong case)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    // The bug that created the failing pod: "Main" (capital M) passed for a repo with "main".
    expect(await remoteBranchExists("https://github.com/x/y", "Main")).toBe(false)
  })

  it("does not false-positive on a prefix match (foo vs foo-bar)", async () => {
    mockFetch(smartHttpBody(["refs/heads/foo-bar"]))
    expect(await remoteBranchExists("https://github.com/x/y", "foo")).toBe(false)
  })

  it("tolerates a trailing slash on the repo URL", async () => {
    let capturedUrl = ""
    _setFetch(async (url) => {
      capturedUrl = url
      return new Response(smartHttpBody(["refs/heads/main"]), { status: 200 })
    })
    expect(await remoteBranchExists("https://github.com/x/y/", "main")).toBe(true)
    expect(capturedUrl).toBe("https://github.com/x/y/info/refs?service=git-upload-pack")
  })

  it("throws RemoteRefsUnreachableError on non-OK HTTP status", async () => {
    mockFetch("", 404)
    await expect(remoteBranchExists("https://github.com/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })

  it("throws RemoteRefsUnreachableError on network failure", async () => {
    mockFetchThrow(new Error("ENOTFOUND"))
    await expect(remoteBranchExists("https://nope.invalid/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })
})

// ---------------------------------------------------------------------------
// BUG REPRODUCE: session activity from opencode instance not used for idle check
//
// The router currently only calls updateLastActivity() on HTTP requests and
// WebSocket upgrades. Long-lived WebSocket connections (used for AI sessions)
// generate no further HTTP traffic after the handshake, so the pod annotation
// goes stale and the pod is killed — even while the user is actively working.
//
// The fix: poll GET /experimental/session?limit=1 on the pod's IP to get the
// real time.updated from the opencode instance, and use that as the authority
// for both idle-pod deletion and the lastActivity returned to the UI.
//
// These tests assert the CORRECT desired behaviour — they currently FAIL.
// ---------------------------------------------------------------------------

/** Build a minimal /experimental/session response body. */
function makeSessionResponse(timeUpdatedMs: number): string {
  return JSON.stringify([{ time: { updated: timeUpdatedMs } }])
}

describe("deleteIdlePods — session activity from opencode instance resets idle timer", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("preserves a pod whose annotation is stale but opencode instance has recent activity", async () => {
    // Annotation is 20 minutes old — beyond the 15-minute default timeout
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // The opencode instance reports activity just 1 minute ago
    mockActivity(Date.now() - 1 * 60_000)

    await deleteIdlePods()

    // Pod must NOT be deleted — instance has recent session activity
    expect(fakePods).toHaveLength(1)
  })

  it("updates the pod annotation with instance activity time when annotation is stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    await deleteIdlePods()

    // Annotation must be refreshed with the recent timestamp from the instance
    expect(patchPodCalls).toHaveLength(1)
    const op = (patchPodCalls[0].body as any)[0]
    expect(op.op).toBe("add")
    expect(op.path).toBe("/metadata/annotations/opencode.ai~1last-activity")
    expect(new Date(op.value).getTime()).toBeGreaterThanOrEqual(recentMs - 1000)
  })

  it("still deletes a pod when both annotation and instance activity are stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // Instance also has no recent activity (20 minutes ago)
    mockActivity(Date.now() - 20 * 60_000)

    await deleteIdlePods()

    // Pod should be deleted — no activity anywhere
    expect(fakePods).toHaveLength(0)
  })
})

describe("listUserSessions — lastActivity reflects opencode instance session time", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("returns instance session time as lastActivity when it is more recent than annotation", async () => {
    // Pod annotation is 20 minutes old
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // But the opencode instance has a session touched just 1 minute ago
    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    const returned = new Date((result[0] as any).lastActivity).getTime()

    // Must return the recent instance time, not the stale annotation
    expect(returned).toBeGreaterThanOrEqual(recentMs - 1000)
  })
})

// ---------------------------------------------------------------------------
// ensurePod with githubToken — Secret lifecycle
// ---------------------------------------------------------------------------

describe("ensurePod with githubToken", () => {
  beforeEach(() => {
    fakeSecrets = []
    createSecretCalls = []
  })

  it("creates a github token Secret when githubToken is provided", async () => {
    fakePVCs = []
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    expect(createSecretCalls).toHaveLength(1)
    const secret = (createSecretCalls[0] as any).body
    expect(secret.metadata.name).toBe(`opencode-github-${computeHash(EMAIL, REPO, "calm-snails-dream")}`)
    expect(secret.stringData?.GITHUB_TOKEN).toBe("gho_test_token")
  })

  it("mounts the Secret via envFrom on both init and main containers", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const initEnvFrom: any[] = pod.spec.initContainers[0].envFrom ?? []
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`

    expect(initEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
  })

  it("init script contains git credential helper setup", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)(
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    expect(script).toContain("credential.helper store")
    expect(script).toContain(".git-credentials")
    expect(script).toContain("GITHUB_TOKEN")
  })

  it("does NOT create a Secret when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    expect(createSecretCalls).toHaveLength(0)
  })

  it("does NOT add github secret envFrom when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)({ email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    const pod = (createPodCalls[0] as any).body
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// terminateSession — deletes github token Secret
// ---------------------------------------------------------------------------

describe("terminateSession — deletes github token Secret", () => {
  it("deletes the github token Secret when it exists", async () => {
    const hash = SESSION_HASH
    const secretName = `opencode-github-${hash}`
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH)]
    fakeSecrets = [{ metadata: { name: secretName, namespace: "opencode" }, stringData: { GITHUB_TOKEN: "gho_test" } }]

    await (terminateSession as any)(hash, EMAIL)

    expect(deleteSecretCalls).toContain(secretName)
  })

  it("succeeds even if github token Secret does not exist (404 ignored)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = [] // no secret

    await expect((terminateSession as any)(SESSION_HASH, EMAIL)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resumeSession — refreshes github token Secret
// ---------------------------------------------------------------------------

describe("resumeSession — refreshes github token Secret", () => {
  it("upserts the github token Secret with the new token before recreating pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = []

    await (resumeSession as any)(SESSION_HASH, EMAIL, "gho_refreshed_token")

    // Secret must have been created (or replaced on existing secret)
    const secretName = `opencode-github-${SESSION_HASH}`
    const created = (createSecretCalls as any[]).some((c) => c.body?.metadata?.name === secretName)
    const replaced = (replaceSecretCalls as any[]).some((c) => c.name === secretName)
    expect(created || replaced).toBe(true)

    // Pod must also have been created
    expect(createPodCalls).toHaveLength(1)
  })
})
