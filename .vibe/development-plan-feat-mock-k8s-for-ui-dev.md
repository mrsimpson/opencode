# Development Plan: opencode (feat/mock-k8s-for-ui-dev branch)

*Generated on 2026-05-19 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal

Mock the Kubernetes dependency in the `opencode-router` backend so the SPA (`opencode-router-app`) can be developed and iterated on without a live k8s cluster.

No live cluster is available during UI development. The mock must:
- Serve realistic fake data for all API endpoints used by the SPA
- Not break existing production code paths
- Be activatable via an env var (`MOCK_K8S=true`)

## Key Decisions

### Revised approach (post-research)

**There is no dedicated npm package for mocking `@kubernetes/client-node`**. However:

1. **The existing test suite already solves the exact problem.** `pod-manager.test.ts` uses a plain hand-rolled fake k8s client object (lines 36-80+) injected via `_setApiClient()`. This fake is a plain object that matches only the methods actually called by `pod-manager.ts`. No library needed.

2. **Revised approach: a single `src/mock-k8s.ts` startup file** — Instead of modifying `api.ts` or `config.ts`, we create `src/mock-k8s.ts` which:
   - Is imported **only** when `MOCK_K8S=true` (via a top-of-file conditional in `index.ts`: `if (process.env.MOCK_K8S) await import("./mock-k8s.js")`)
   - Calls `_setApiClient(fakek8sClient)` from `pod-manager.ts` with an in-memory fake
   - Sets `process.env.OPENCODE_IMAGE = "mock-image:latest"` and `process.env.ROUTER_DOMAIN = "localhost:3002"` **before** `config.ts` is evaluated (so the `required()` calls succeed without any change to `config.ts`)
   - Pre-seeds in-memory session state

3. **`api.ts` top-level k8s client (lines 5-7)** — This is the only remaining concern. The `api.ts` top-level code creates a `KubeConfig` and calls `makeApiClient`. This **does not connect or throw** at module load time — it only fails when an API method is actually called. Since all pod operations in `api.ts` go through `pod-manager.ts` functions (not the local `k8sApi`), this top-level client in `api.ts` is **never actually used**. Confirmed: `k8sApi` in `api.ts` is imported but not referenced anywhere in the file. It is dead code. So **no change to `api.ts` is needed**.

4. **Minimal production code changes** — Only one tiny guard in `index.ts` (the conditional import). Zero changes to `config.ts`, `api.ts`, or `pod-manager.ts`.

5. **In-memory state in `mock-k8s.ts`** — Fake PVCs and Pods in `Map` structures, seeded with a variety of states to exercise all UI paths (creating, running, stopped). Operations like `ensurePVC`, `ensurePod`, `terminateSession`, `resumeSession` mutate these maps.

6. **SSE session startup simulation** — For the `/events` SSE endpoint, the mock's `getPodState` and `getSessionInfo` will return `creating` initially and transition to `running` after a short in-memory timer, letting the SPA startup progress UI be exercised.

7. **`remoteBranchExists`** — Always returns `true` under mock (set via `_setFetch`).

8. **`getUserSecret` / `ensureUserSecret` / `deleteUserSecret`** — Use an in-memory per-email `Map` (set via `_setApiClient` fake that handles `readNamespacedSecret`, `createNamespacedSecret`, `replaceNamespacedSecret`, `deleteNamespacedSecret`).

9. **`suggestBranch`** — Uses `humanId` internally; already works without k8s. No mock needed.

10. **`.env.local.example`** — Add `MOCK_K8S=true` block with instructions.

### Why no k8s mock library?

- No dedicated npm package for `@kubernetes/client-node` mocking exists.
- The `@kubernetes/client-node` library itself is HTTP-based and `msw` *could* intercept its calls, but that would be more complex than the existing `_setApiClient()` injection pattern already used in tests.
- The existing test suite pattern (hand-rolled fake client + `_setApiClient`) is the right approach — it's already proven, already typed, already used in this codebase.

## Notes

### Codebase Overview

Three relevant packages:
| Package | Purpose |
|---|---|
| `packages/opencode-router` | Node.js/Bun backend (Hono) |
| `packages/opencode-router-app` | SolidJS SPA served by the backend |
| `packages/opencode-router-plugin` | In-pod plugin (irrelevant to mock) |

### Key Files

| File | Notes |
|---|---|
| `packages/opencode-router/src/config.ts` | Env vars; `OPENCODE_IMAGE` + `ROUTER_DOMAIN` required — **no change needed** (env vars set before import in mock-k8s.ts) |
| `packages/opencode-router/src/index.ts` | **One-line change**: `if (process.env.MOCK_K8S) await import("./mock-k8s.js")` at top |
| `packages/opencode-router/src/api.ts` | `k8sApi` created at top-level but never used in any handler — **no change needed** |
| `packages/opencode-router/src/pod-manager.ts` | Has `_setApiClient`, `_setFetch` etc — **no change needed** |
| `packages/opencode-router/src/mock-k8s.ts` | **New file** — the entire mock |
| `packages/opencode-router/.env.local.example` | Add `MOCK_K8S=true` block |

### All API Endpoints the SPA Calls (must be mocked)

| Method | Path | Covered by mock? |
|---|---|---|
| GET | `/api/sessions` | ✅ via `listUserSessions` fake |
| GET | `/api/sessions/stream` | ✅ SSE driven by `sessionsChangedBroadcaster` |
| POST | `/api/sessions` | ✅ via `startSession` / `ensurePVC` + `ensurePod` fakes |
| GET | `/api/sessions/:hash` | ✅ via `getPodState` fake |
| GET | `/api/sessions/:hash/events` | ✅ via `getSessionInfo` + `getSessionProgress` fakes (with timer) |
| POST | `/api/sessions/:hash/resume` | ✅ via `resumeSession` fake |
| DELETE | `/api/sessions/:hash` | ✅ via `terminateSession` fake |
| GET | `/api/sessions/suggest-branch` | ✅ `suggestBranch` already works (uses `humanId`, no k8s) |
| GET | `/api/user/repos` | ✅ mock returns fake repo list (no k8s involved — hits GitHub API; mock returns static data) |
| GET | `/api/user/repos/branches` | ✅ mock returns fake branch list |
| GET | `/api/user/secret` | ✅ via fake k8s secret store |
| POST | `/api/user/secret` | ✅ via fake k8s secret store |
| DELETE | `/api/user/secret` | ✅ via fake k8s secret store |

### Injection Hooks in pod-manager.ts

```ts
_setApiClient(client)      // replace k8s CoreV1Api fake
_setFetch(fn)              // replace fetch used by remoteBranchExists
_setActivityFetch(fn)      // replace fetch used to poll pod activity
_setBootstrapFetch(fn)     // replace fetch used for pod bootstrap
_setEmitSessionsChanged()  // (not needed — real broadcaster is fine)
```

### Fake k8s client methods needed (from test suite pattern)

```ts
{
  listNamespacedPersistentVolumeClaim,
  listNamespacedPod,
  readNamespacedPod,
  readNamespacedPersistentVolumeClaim,
  createNamespacedPod,
  createNamespacedPersistentVolumeClaim,
  patchNamespacedPod,
  patchNamespacedPersistentVolumeClaim,
  deleteNamespacedPod,
  deleteNamespacedPersistentVolumeClaim,
  createNamespacedSecret,
  readNamespacedSecret,
  replaceNamespacedSecret,
  deleteNamespacedSecret,
}
```

### Pre-seeded mock sessions

| hash | state | repoUrl | branch | notes |
|---|---|---|---|---|
| `abc123def456` | `running` | `https://github.com/example/myapp` | `feature-login` | Has URL |
| `deadbeef1234` | `stopped` | `https://github.com/example/api` | `fix-auth` | No pod |
| `cafe00112233` | `creating` | — | — | Blank project, transitions to running after 5 s |

### Dev Environment

- Router runs on `localhost:3002`; session URLs are `http://<hash>-oc.localhost:3002`
- `DEV_EMAIL=dev@local.test` bypasses OAuth
- `DEV_VITE_URL=http://localhost:5173` proxies to Vite dev server
- `MOCK_K8S=true` activates the mock

## Explore
<!-- beads-phase-id: opencode-13.1 -->
### Tasks
<!-- beads-synced: 2026-05-19 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Plan
<!-- beads-phase-id: opencode-13.2 -->
### Tasks
<!-- beads-synced: 2026-05-19 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Code
<!-- beads-phase-id: opencode-13.3 -->
### Tasks
<!-- beads-synced: 2026-05-19 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-13.3.1` Add one-line MOCK_K8S guard to index.ts
- [x] `opencode-13.3.2` Create src/mock-k8s.ts with in-memory fake k8s client and pre-seeded sessions
- [x] `opencode-13.3.3` Add MOCK_K8S block to .env.local.example

## Final Implementation Summary

### Changes Made

1. **`packages/opencode-router/src/index.ts`** — Added one-line conditional import at the very top: `if (process.env.MOCK_K8S) await import("./mock-k8s.js")`. This is the only modification to existing production code.

2. **`packages/opencode-router/src/mock-k8s.ts`** — New file (~280 lines). Implements an in-memory fake Kubernetes client that intercepts all k8s calls made by `pod-manager.ts` via its existing `_setApiClient` injection hook. Also wires `_setFetch`, `_setActivityFetch`, `_setBootstrapFetch`, and `_setHumanId` to provide deterministic, cluster-free behavior.

3. **`packages/opencode-router/.env.local.example`** — Added a `MOCK_K8S=true` block with inline documentation explaining when and how to use it.

### Code Quality

- Removed `as any` casts from in-memory store operations by introducing minimal local types (`FakePVC`, `FakePod`, `FakeSecret`, `KMeta`).
- One intentional `as any` remains on `_setApiClient(fakeK8sApi as any)` because the fake object only implements the subset of `ObjectCoreV1Api` methods actually called by `pod-manager.ts`.
- No debug artifacts, TODOs, or commented-out code remain.
- `bun typecheck` passes clean.

### Test Validation

- Test suite: **203 pass, 11 fail** — same 11 failures as baseline (pre-existing, unrelated to this change). No regressions introduced.

### How to Use

```bash
cd packages/opencode-router
cp .env.local.example .env.local
# Uncomment the MOCK_K8S=true line, or set:
export MOCK_K8S=true
export DEV_EMAIL=dev@local.test
export DEV_VITE_URL=http://localhost:5173
bun dev
```

The router will start on `localhost:3002` with three pre-seeded sessions:
- `abc123def456` — running
- `deadbeef1234` — stopped
- `cafe00112233` — creating (auto-transitions to running after 5 s)

## Commit
<!-- beads-phase-id: opencode-13.4 -->
### Tasks
<!-- beads-synced: 2026-05-19 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-13.4.1` Code cleanup: review console.log/debug output in mock-k8s.ts
- [x] `opencode-13.4.2` Documentation review: update plan file with final implementation notes
- [x] `opencode-13.4.3` Final validation: run tests to confirm no regressions
- [x] `opencode-13.4.4` Create git commit
