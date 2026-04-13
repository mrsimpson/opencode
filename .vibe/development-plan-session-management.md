# Development Plan: opencode (session-management branch)

_Generated on 2026-04-12 by Vibe Feature MCP_
_Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)_

## Goal

Improve session lifecycle management in the `opencode-router`:

1. **PVC creation** — currently PVCs are always created eagerly on session creation. We want fine-grained control: understand and document when/how PVCs are created, and ensure the process is robust.
2. **Session termination vs. suspension** — currently idle pods are hard-deleted after a timeout. We want a distinction between "suspend" (delete pod, keep PVC, session resumable) and "terminate" (delete pod + PVC, unrecoverable). The API and UI should expose both.
3. **Session resume** — currently a returning user triggers `ensurePod` implicitly when they navigate to the session URL. We want an explicit "resume" action that lets users resume a suspended session from the sessions list without manually navigating to the URL.

## Key Decisions

- **PVC = Session identity**: the PVC is the durable record of a session. The pod is ephemeral compute. A session exists as long as its PVC exists.
- **Session state**: derived by correlating PVC existence with pod state → `"creating" | "running" | "stopped"`. `"stopped"` means PVC exists, no pod (idle-cleaned or never started after creation). No new `PodState` enum values needed.
- **List sessions**: `listUserSessions` scans PVCs (not pods) as the primary source of truth, then correlates each PVC with its pod state.
- **Resume action**: `POST /api/sessions/:hash/resume` — recreates the pod for an existing PVC (calls `ensurePod`). Idempotent.
- **Terminate action**: `DELETE /api/sessions/:hash` — explicit, destructive: deletes pod (if present) + PVC. Removes entry from activityThrottle.
- **Idle cleanup unchanged**: continues to delete only the pod; session becomes `"stopped"` and is resumable.
- **Idle timeout**: default reduced to `15` minutes (was 30). Still configured via `IDLE_TIMEOUT_MINUTES`. No per-session override.
- **Transparency**: `SessionInfo` returned by `listUserSessions` and `GET /api/sessions/:hash` must include `lastActivity` (ISO timestamp) and the configured `idleTimeoutMinutes`. The UI computes "stops in ~Xm" for running sessions from these two values.
- **Branch name generation**: server-side, via `human-id` npm package (zero deps, MIT, 15M combinations). Format: `adjective-noun-verb` with `-` separator, lowercase (e.g. `calm-snails-dream`). New endpoint `GET /api/sessions/suggest-branch?email=...&repoUrl=...` generates names until it finds one whose `(email, repoUrl, branch)` hash does not collide with an existing PVC. Frontend pre-fills the branch field with the suggestion; user can still edit it.
- **Authorization**: session owner only (email from `X-Auth-Request-Email` must match PVC annotation). No admin role in the API — k8s API serves that purpose.
- **Session listing scope**: always scoped to the calling user. No cross-user listing.

### Correction: branch handling (task 1.3.14)

The initial implementation conflated two distinct concepts under `branch`:

- **`sourceBranch`** — the branch the user wants to start from (e.g. `main`). User must enter this. Used only in the init container to set the starting point before creating the session branch.
- **`sessionBranch`** (aka `branch` in `SessionKey`) — the unique branch created for this session (e.g. `calm-snails-dream`). Auto-generated via `suggestBranch`, display-only in the UI for now. This is the branch that ends up in the PVC annotation and forms part of the session identity hash.

The git init container must:

1. Clone `repoUrl` if not already cloned
2. Fetch all
3. Checkout `sourceBranch` (the user's starting point)
4. Create new branch `sessionBranch` from there (always a new local branch)

`SessionKey` gains a `sourceBranch` field. `getSessionHash` continues to use `(email, repoUrl, branch)` where `branch` = sessionBranch. The form shows: repo URL field, source branch field ("start from"), and a display-only session branch label ("your session branch: calm-snails-dream"). `suggestBranch` is called after the user enters a valid repo URL.

### Implementation decisions (Code phase)

- **sourceBranch vs sessionBranch split (1.3.14)**: `SessionKey.sourceBranch` = user-entered branch to start from (e.g. `main`). `SessionKey.branch` = auto-generated session branch (e.g. `calm-snails-dream`), stored in PVC annotation, forms the identity hash. Git init: clone → checkout `sourceBranch` → `git checkout -b sessionBranch`. Session branches are always new; no remote lookup needed. Both annotations stored on PVC and pod for resumeSession reconstruction. `createSession` API now requires `{ repoUrl, branch, sourceBranch }`. Form shows repo URL + source branch fields + display-only session branch label.
- **`human-id` type import**: the package is CJS, and with `moduleResolution: nodenext` the default export isn't typed as callable. Cast at call site: `(humanId as unknown as (opts?: object) => string)`.
- **`GET /api/sessions/:hash` enrichment**: instead of a new `getSessionInfo` function in pod-manager, the handler calls `listUserSessions(email, req)` and finds the matching hash. Falls back to `getPodState` + synthesized fields for sessions not owned by the requesting user.
- **Route ordering**: `suggest-branch` route checked before `/:hash` regex in `api.ts` (the path is not 12 hex chars so won't false-match, but explicit ordering is clearer).
- **Testing SolidJS components**: No component rendering tests — pure logic is extracted to separate files (`session-utils.ts`, `setup-form-utils.ts`) with no SolidJS imports, following the pattern used throughout the `packages/app` and `packages/ui` packages. Component files import and re-export these utilities; tests import only the utility files.
- **`bun:test` types in router-app**: added `bun-types` dev dependency and `"bun-types"` to `tsconfig.json` `types` array to fix TypeScript errors in test files.
- **`setup-form-utils.ts` split**: `buildSessionKey` lives in a standalone pure module to avoid the Kobalte/SolidJS server-side crash when bun imports the component file in tests.
- **Dev-mode pod proxy (1.3.15)**: Locally, pod IPs are cluster-internal and unreachable. New `dev-proxy.ts` module auto-spawns `kubectl port-forward` per session hash on first request, caches the local port, and returns `http://localhost:<port>` as proxy target. Enabled when any dev env var (`DEV_EMAIL`, `DEV_VITE_URL`, `DEV_POD_PROXY_TARGET`) is set. `DEV_POD_PROXY_TARGET` still works as a single-target override. Forwards are cleaned up on shutdown.

## Notes

### Current codebase snapshot (Explore phase findings)

**`packages/opencode-router/src/pod-manager.ts`**

- `ensurePVC(session)` — idempotent, creates PVC if absent. Called from `POST /api/sessions`.
- `ensurePod(session)` — idempotent, creates Pod if absent. Called from `POST /api/sessions`.
- `getPodState(hash)` → `"none" | "creating" | "running"` — only looks at the pod, not the PVC.
- `listUserSessions(email, req)` — lists pods with managed-by label; only returns active/creating pods, **not** suspended sessions (PVC present, no pod).
- `updateLastActivity(hash)` — throttled patch of annotation on the pod.
- `deleteIdlePods()` — deletes pods idle > `IDLE_TIMEOUT_MINUTES`; PVC preserved. Runs every 60s.

**`packages/opencode-router/src/api.ts`**

- `GET /api/sessions` — lists sessions for user (calls `listUserSessions`).
- `POST /api/sessions` — creates PVC + Pod; returns `{ hash, url, state: "creating" }`.
- `GET /api/sessions/:hash` — returns pod state.
- **Missing**: no endpoint to suspend, terminate, or resume a session.

**`packages/opencode-router-app/src/app.tsx`**

- Sessions list only shows active/creating pods; no suspend/terminate/resume actions.

**`deployment/homelab/src/index.ts`**

- RBAC does not include `delete` verb on PVCs — needs updating to support termination.

## Explore

<!-- beads-phase-id: opencode-1.1 -->

### Tasks

_Tasks managed via `bd` CLI_

## Plan

<!-- beads-phase-id: opencode-1.2 -->

### Tasks

_Tasks managed via `bd` CLI_

| ID              | Title                                                                                   |
| --------------- | --------------------------------------------------------------------------------------- |
| opencode-1.2.1  | pod-manager: add stopped state + listUserSessions from PVCs                             |
| opencode-1.2.2  | pod-manager: add terminateSession (delete pod + PVC)                                    |
| opencode-1.2.3  | pod-manager: add resumeSession (ensurePod for stopped session)                          |
| opencode-1.2.4  | pod-manager: add suggestBranch using human-id package                                   |
| opencode-1.2.5  | api.ts: add DELETE /api/sessions/:hash (terminate)                                      |
| opencode-1.2.6  | api.ts: add POST /api/sessions/:hash/resume                                             |
| opencode-1.2.7  | api.ts: add GET /api/sessions/suggest-branch?repoUrl=                                   |
| opencode-1.2.8  | api.ts: include lastActivity + idleTimeoutMinutes in session list and get               |
| opencode-1.2.9  | config.ts: reduce default IDLE_TIMEOUT_MINUTES from 30 to 15                            |
| opencode-1.2.10 | router-app api.ts: add stopped state, resume, terminate, suggestBranch                  |
| opencode-1.2.11 | router-app app.tsx: show stopped sessions, idle countdown, Resume and Terminate buttons |
| opencode-1.2.12 | router-app setup-form.tsx: pre-fill branch from suggest-branch endpoint                 |
| opencode-1.2.13 | deployment: add delete verb on PVCs to RBAC role                                        |

### Implementation Order & Dependencies

```
[1.2.9] config.ts default timeout
    ↓
[1.2.1] pod-manager: PVC-first list + stopped state   ← foundation for everything
    ├─→ [1.2.2] pod-manager: terminateSession
    ├─→ [1.2.3] pod-manager: resumeSession
    └─→ [1.2.4] pod-manager: suggestBranch (needs human-id package install first)
         ↓
[1.2.5] api: DELETE /api/sessions/:hash    (depends on 1.2.2)
[1.2.6] api: POST /api/sessions/:hash/resume  (depends on 1.2.3)
[1.2.7] api: GET /api/sessions/suggest-branch (depends on 1.2.4)
[1.2.8] api: lastActivity + idleTimeoutMinutes in responses (depends on 1.2.1)
    ↓
[1.2.10] router-app api.ts client types + callers  (depends on 1.2.5/6/7/8)
    ├─→ [1.2.11] router-app app.tsx UI
    └─→ [1.2.12] router-app setup-form.tsx branch pre-fill
[1.2.13] deployment RBAC (independent, can land any time)
```

### Edge Cases & Risks

| Risk                                              | Mitigation                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PVC delete while pod still running                | k8s handles via Terminating finalizer; pod cleanup happens naturally                                     |
| `listUserSessions` N+1 pod lookups                | Batch: list all pods once, build hash→pod map, then correlate without extra API calls                    |
| `suggestBranch` loop infinite                     | Cap at 10 iterations; return last attempt regardless                                                     |
| Route ordering: `/suggest-branch` before `/:hash` | `suggest-branch` is not 12 hex chars — won't match hash regex; but keep route order explicit for clarity |
| Auth bypass on resume/terminate                   | Always re-validate email against PVC annotation server-side                                              |
| `human-id` not yet installed                      | Add to `dependencies` in `packages/opencode-router/package.json` before implementing 1.2.4               |

## Code

<!-- beads-phase-id: opencode-1.3 -->

### Tasks

_Tasks managed via `bd` CLI — design details are in each task's description_

| ID              | Title                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| opencode-1.3.1  | config.ts: reduce default IDLE_TIMEOUT_MINUTES from 30 to 15              |
| opencode-1.3.2  | pod-manager: stopped state + listUserSessions from PVCs                   |
| opencode-1.3.3  | pod-manager: add terminateSession (delete pod + PVC)                      |
| opencode-1.3.4  | pod-manager: add resumeSession (recreate pod for stopped session)         |
| opencode-1.3.5  | pod-manager: add suggestBranch (collision-safe human-id name)             |
| opencode-1.3.6  | api.ts: DELETE /api/sessions/:hash (terminate)                            |
| opencode-1.3.7  | api.ts: POST /api/sessions/:hash/resume                                   |
| opencode-1.3.8  | api.ts: GET /api/sessions/suggest-branch?repoUrl=                         |
| opencode-1.3.9  | api.ts: include lastActivity + idleTimeoutMinutes in session list and get |
| opencode-1.3.10 | router-app api.ts: update types + add resume, terminate, suggestBranch    |
| opencode-1.3.11 | router-app app.tsx: stopped sessions, idle countdown, Resume + Terminate  |
| opencode-1.3.12 | router-app setup-form.tsx: auto-fill branch from suggest-branch endpoint  |
| opencode-1.3.13 | deployment: add delete verb on PVCs to RBAC role                          |

## Commit

<!-- beads-phase-id: opencode-1.4 -->

### Tasks

_Tasks managed via `bd` CLI_

---

_This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management._
