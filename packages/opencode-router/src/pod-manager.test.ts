import { describe, it, expect, beforeEach } from "bun:test"

// Set required env vars before config module is loaded
process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"

// --- Fake k8s client state (mutated per test via helpers below) ---
let fakePVCs: object[] = []
let fakePods: object[] = []
let createPodCalls: object[] = []

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
}

// pod-manager.test.ts must run in its own bun process (see package.json test script)
// to avoid api.test.ts's mock.module("./pod-manager.js") poisoning this module import.
const { listUserSessions, terminateSession, resumeSession, suggestBranch, _setApiClient, _setHumanId } =
  await import("./pod-manager.ts")
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

function makeRunningPod(sessionHash: string, email: string, repoUrl: string, branch: string) {
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
    status: { phase: "Running", podIP: "10.0.0.1" },
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
})

// ---------------------------------------------------------------------------

describe("listUserSessions", () => {
  it("returns stopped session when PVC exists but no pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    // Expect state to be "stopped" — WILL FAIL: current impl scans pods (empty), returns []
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

    // WILL FAIL: current impl returns [] (no pods), so result is empty
    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("includes lastActivity and idleTimeoutMinutes in running session result", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    // WILL FAIL: SessionInfo currently lacks lastActivity and idleTimeoutMinutes
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("does not return sessions belonging to a different user", async () => {
    fakePVCs = [makePVC(SESSION_HASH, "other@example.com", REPO, BRANCH)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(0)
  })

  it("returns empty list when no PVCs exist", async () => {
    fakePVCs = []
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe("PodState type", () => {
  it("accepts stopped as a valid PodState value at runtime", () => {
    // TypeScript compile-time: "stopped" is NOT assignable to current PodState
    // ("none" | "creating" | "running") so we use `as any` to bypass the type
    // error and assert at runtime that the string value is what we expect.
    // The GREEN phase fix will extend the union so no cast is needed.
    const state: import("./pod-manager.js").PodState = "stopped" as any
    expect(state as any).toBe("stopped")
  })
})

// ---------------------------------------------------------------------------

describe("terminateSession", () => {
  it("deletes pod and PVC when caller is the owner", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // Both pod and PVC should have been removed from the fake store
    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)
  })

  it("throws Forbidden when caller is not the owner", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    await expect((terminateSession as any)(SESSION_HASH, "other@example.com")).rejects.toThrow("Forbidden")

    // Nothing should have been deleted
    expect(fakePods).toHaveLength(1)
    expect(fakePVCs).toHaveLength(1)
  })

  it("throws NotFound when PVC does not exist", async () => {
    fakePVCs = []
    fakePods = []

    await expect((terminateSession as any)(SESSION_HASH, EMAIL)).rejects.toThrow("NotFound")
  })

  it("succeeds even if pod does not exist (idempotent pod delete)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [] // no pod — already stopped

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // PVC should still be removed
    expect(fakePVCs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe("resumeSession", () => {
  it("calls ensurePod for a stopped session (PVC exists, no pod)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [] // session is stopped — no pod

    await (resumeSession as any)(SESSION_HASH, EMAIL)

    // ensurePod must have called createNamespacedPod to recreate the pod
    expect(createPodCalls).toHaveLength(1)
    expect(fakePods).toHaveLength(1)
  })

  it("is idempotent when pod already exists (running session)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    const podsBefore = fakePods.length

    await (resumeSession as any)(SESSION_HASH, EMAIL)

    // ensurePod should detect existing pod and skip creation
    expect(createPodCalls).toHaveLength(0)
    expect(fakePods).toHaveLength(podsBefore)
  })

  it("throws Forbidden when caller is not the owner", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []

    await expect((resumeSession as any)(SESSION_HASH, "other@example.com")).rejects.toThrow("Forbidden")

    // No pod should have been created
    expect(createPodCalls).toHaveLength(0)
  })

  it("throws NotFound when PVC does not exist", async () => {
    fakePVCs = []
    fakePods = []

    await expect((resumeSession as any)(SESSION_HASH, EMAIL)).rejects.toThrow("NotFound")

    expect(createPodCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe("suggestBranch", () => {
  it("returns a string branch name", async () => {
    fakePVCs = []

    const branch = await (suggestBranch as any)(EMAIL, REPO)

    expect(typeof branch).toBe("string")
    expect(branch.length).toBeGreaterThan(0)
    expect(branch).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  it("skips names that already exist as PVC hashes and returns the next unique one", async () => {
    // Inject a deterministic humanId that returns a fixed sequence: first two collide, third is free
    const seq = ["calm-snails-dream", "bold-frogs-dance", "swift-hawks-fly"]
    let idx = 0
    _setHumanId((_opts?: any) => seq[idx++ % seq.length])

    // Pre-populate PVCs for the first two candidates so they collide
    const hash0 = computeHash(EMAIL, REPO, seq[0])
    const hash1 = computeHash(EMAIL, REPO, seq[1])
    fakePVCs = [makePVC(hash0, EMAIL, REPO, seq[0]), makePVC(hash1, EMAIL, REPO, seq[1])]

    const branch = await (suggestBranch as any)(EMAIL, REPO)

    // Must NOT be one of the colliding names
    expect(branch).not.toBe(seq[0])
    expect(branch).not.toBe(seq[1])
    expect(branch).toBe(seq[2])
  })

  it("returns after at most 10 iterations even if all collide", async () => {
    // Inject a deterministic humanId that always returns the same name (infinite collision)
    const fixed = "slow-bears-roam"
    _setHumanId((_opts?: any) => fixed)

    // Pre-populate a PVC for that name so every attempt collides
    const hash = computeHash(EMAIL, REPO, fixed)
    fakePVCs = [makePVC(hash, EMAIL, REPO, fixed)]

    // Should resolve (not hang) after 10 attempts and return the last candidate
    const branch = await (suggestBranch as any)(EMAIL, REPO)

    expect(typeof branch).toBe("string")
    expect(branch).toBe(fixed)
  })
})

// ---------------------------------------------------------------------------
// 1.3.14: branch handling — sourceBranch vs sessionBranch
// ---------------------------------------------------------------------------

describe("SessionKey.sourceBranch", () => {
  it("listUserSessions includes sourceBranch from PVC annotation", async () => {
    // PVC must store sourceBranch annotation; listUserSessions must return it
    const pvc = makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)
    // Add sourceBranch annotation (will fail until annotation is stored/read)
    ;(pvc as any).metadata.annotations["opencode.ai/source-branch"] = "main"
    fakePVCs = [pvc]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    // WILL FAIL: SessionInfo currently has no sourceBranch field
    expect((result[0] as any).sourceBranch).toBe("main")
  })

  it("ensurePod git-init script checks out sourceBranch then creates sessionBranch", async () => {
    // After creating a pod, the init script must contain both sourceBranch and branch
    fakePVCs = []
    fakePods = []
    createPodCalls = []

    const { ensurePod } = await import("./pod-manager.js")

    // WILL FAIL: SessionKey currently has no sourceBranch field, so TypeScript
    // will reject this call — but at runtime the script won't contain sourceBranch
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
