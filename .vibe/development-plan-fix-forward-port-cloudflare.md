# Development Plan: opencode (fix/forward-port-cloudflare branch)

*Generated on 2026-05-03 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal

Replace the broken exec-based port polling in the operator with a **push-from-pod** approach:
a background task inside the `opencode` binary watches `/proc/net/tcp`, detects new user dev-server ports, and POSTs `POST /api/sessions/:hash/ports` to the router using the already-injected `OPENCODE_ROUTER_URL` / `OPENCODE_SESSION_HASH` / `OPENCODE_POD_SECRET` env vars.

The router stores the port list per session. The operator polls `GET /api/sessions/:hash/ports` (admin-secret auth) and creates **only Traefik IngressRoutes** for new ports — no individual Cloudflare DNS records or tunnel ingress rules, because a wildcard DNS/tunnel entry already covers `*.domain`.

## Key Decisions

- **Push from pod, not exec-based polling**: pod pushes ports via HTTP using existing credentials; removes need for `k8s.Exec` RBAC in the operator.
- **Watcher lives in the opencode binary**: background goroutine/async task reads `/proc/net/tcp` and calls `pushPort` using the same router-plugin pattern as `pushEvent`; no sidecar container needed.
- **No per-port Cloudflare DNS/tunnel entries**: a wildcard DNS CNAME and Cloudflare Tunnel ingress rule already covers `*.domain`; only Traefik IngressRoutes need to be created per port hostname.
- **Operator polls router for port list**: operator calls `GET /api/sessions/:hash/ports` (admin-secret auth) on its existing 30s cycle and creates IngressRoutes for newly reported ports; operator remains source of truth for Cloudflare/Traefik provisioning.
- **Port hostname pattern**: `<port>-<hash><routeSuffix>.<domain>` e.g. `5173-abc123def456-oc.no-panic.org` (already implemented in `sessionPortHostname`).
- **Auth for push endpoint**: `POST /api/sessions/:hash/ports` authenticated via `x-pod-secret` header (same as `/progress` endpoint) — bypasses email gate in `index.ts`.
- **Auth for operator poll endpoint**: `GET /api/sessions/:hash/ports` authenticated via `x-admin-secret` header — needs special-casing in `index.ts` like `/api/admin/` is.
- **Filter**: ports `> 3000` and `!= config.opencodePort (4096)` and `<= 65535`.
- **Port watcher location**: `packages/opencode-router-plugin/src/port-watcher.ts` — lives alongside `plugin.ts`, uses same `pushEvent`-style pattern, started from `plugin.ts`'s `RouterPlugin` function.
- **Port watcher trigger**: starts once inside `RouterPlugin` alongside the startup replay timer; polls every 5s; on Linux reads `/proc/net/tcp`; on non-Linux (dev) is a no-op.
- **Operator config addition**: operator needs `ROUTER_ADMIN_SECRET` env var to authenticate `GET /api/sessions/:hash/ports` calls to the router.
- **In-memory port store in router**: simple `Map<string, Set<number>>` in a new `packages/opencode-router/src/port-store.ts`; cleared when pod secret is deleted (session terminated).
- **Operator replaces exec polling with router poll**: `startPodPoller` fetches `GET routerServiceUrl/api/sessions/:hash/ports` with `x-admin-secret` header; no `k8s.Exec` calls.
- **`POST /api/sessions/:hash/ports` gating**: same pattern as `POST .../progress` — handled BEFORE the email check in `index.ts` by checking for `x-pod-secret` header without email requirement.
- **`GET /api/sessions/:hash/ports` gating**: handled in `index.ts` alongside `/api/admin/` — check `x-admin-secret` before email check; route into `handleApi` with `admin@localhost`.

## Notes

### Current state (as of explore phase)

**Interim fix already implemented and working** (`deployment/opencode-cloudflare-operator/src/index.ts`):
- `getPodListeningPorts(podName, namespace)` — `k8s.Exec` based, reads `/proc/net/tcp` inside pod
- `startPodPoller` / `stopPodPoller` — 30s periodic loop per active pod
- `provisionPort` — calls `createDnsRecord` + `createTunnelRoute` + `createIngressRoutes` for each new port
- Per-port cleanup in `onPodDeleted`
- All 27 operator tests + 76 router tests pass; both packages typecheck clean

**The interim exec-based approach is replaced by this plan.**

### Relevant files

- `deployment/opencode-cloudflare-operator/src/index.ts` — operator: pod watch, port polling loop, cloudflare/traefik provisioning
- `deployment/opencode-cloudflare-operator/src/config.ts` — operator config: `opencodePort`, `sessionHostname`, `sessionPortHostname`
- `deployment/opencode-cloudflare-operator/src/ingressroute.ts` — Traefik IngressRoute CRD management (create/delete per hostname)
- `deployment/opencode-cloudflare-operator/src/cloudflare.ts` — Cloudflare DNS/tunnel CRUD (NOT needed per-port with wildcard)
- `deployment/opencode-cloudflare-operator/tests/operator.test.ts` — operator unit tests (vitest)
- `packages/opencode-router/src/api.ts` — router API handler; existing `POST /api/sessions/:hash/progress` pattern to follow
- `packages/opencode-router/src/index.ts` — router HTTP server; email auth gate; admin-secret gate
- `packages/opencode-router/src/pod-manager.ts` — injects `OPENCODE_ROUTER_URL`, `OPENCODE_SESSION_HASH`, `OPENCODE_POD_SECRET`
- `packages/opencode-router/src/pod-secret-store.ts` — `podSecretStore.verify(hash, secret)` used by progress push
- `packages/opencode-router-plugin/src/plugin.ts` — existing push pattern: `pushEvent` → `POST .../progress` with `x-pod-secret`
- `packages/opencode-router-plugin/src/index.ts` — `RouterPlugin` function; startup replay timer lives here
- opencode binary location: `packages/opencode` (TypeScript/Bun) — port watcher goes here via `opencode-router-plugin`

### Architecture overview

```
[opencode binary / opencode-router-plugin]
  RouterPlugin starts bg watcher (alongside startup replay)
  port-watcher.ts: poll /proc/net/tcp every 5s
  → POST OPENCODE_ROUTER_URL/api/sessions/HASH/ports {ports: [5173, 8080]}
    x-pod-secret: OPENCODE_POD_SECRET

[opencode-router]
  index.ts:
    POST /api/sessions/:hash/ports  → pod-secret check → handleApi
    GET  /api/sessions/:hash/ports  → admin-secret check → handleApi
  api.ts:
    POST /api/sessions/:hash/ports  — store ports in portStore
    GET  /api/sessions/:hash/ports  — return ports from portStore
  port-store.ts:
    Map<hash, Set<number>>

[opencode-cloudflare-operator]
  config: adds ROUTER_ADMIN_SECRET + ROUTER_SERVICE_URL (already exists)
  startPodPoller: GET routerServiceUrl/api/sessions/:hash/ports (x-admin-secret)
    → for each new port: createIngressRoutes only (no DNS/tunnel)
    → (skip createDnsRecord + createTunnelRoute — wildcard covers it)
  onPodDeleted: deleteIngressRoutes for all provisioned port hostnames
  Removes: getPodListeningPorts, k8s.Exec import, Exec mock from tests
```

### Detailed implementation steps

#### Step 1: Router — port store (`packages/opencode-router/src/port-store.ts`)
- New module exporting `portStore` with:
  - `set(hash, ports)` — stores `Set<number>` for hash (overwrites)
  - `get(hash)` → `number[]` — returns sorted array
  - `delete(hash)` — called on session termination

#### Step 2: Router — API endpoints (`packages/opencode-router/src/api.ts`)
- Add `POST /api/sessions/:hash/ports`:
  - Match regex `^\/api\/sessions\/([a-f0-9]{12})\/ports$`, method POST
  - Check `x-pod-secret` header via `podSecretStore.verify(hash, secret)`
  - Parse body `{ports: number[]}`
  - Validate: array of integers, filter `> 3000 && != 4096 && <= 65535`
  - Store via `portStore.set(hash, new Set(validPorts))`
  - Return `200 {ok: true}`
- Add `GET /api/sessions/:hash/ports`:
  - Match regex `^\/api\/sessions\/([a-f0-9]{12})\/ports$`, method GET
  - Auth: handled upstream in `index.ts` (admin-secret gate), `handleApi` receives `admin@localhost`
  - Return `200 {ports: portStore.get(hash)}`

#### Step 3: Router — server gating (`packages/opencode-router/src/index.ts`)
- Pod-secret endpoints bypass email check (like `/progress`):
  - Currently the `POST .../progress` is handled inside `handleApi` which is called after email check
  - **However** the existing `POST .../progress` works because `handleApi` checks the pod secret itself and doesn't use `email` for those routes
  - The pod-secret POST should be gated the same way — no email needed; `handleApi` checks pod secret
  - So `POST /api/sessions/:hash/ports` can go through the same path as `/progress` (no changes to `index.ts` for pod-secret POST — it already bypasses `email` in `handleApi`)
- Admin-secret GET endpoint needs `index.ts` change:
  - Add handling for `GET /api/sessions/:hash/ports` with `x-admin-secret` before email check
  - Pattern: regex match the URL, check `x-admin-secret === config.adminSecret`, then call `handleApi`
  - Alternative: broaden the existing admin check to cover GET as well as POST for these routes
  - **Decision**: Add a new gate for `GET /api/sessions/:hash/ports` matching the existing admin-secret pattern

#### Step 4: Router — cleanup on session termination
- In `pod-manager.ts` or wherever `podSecretStore.delete(hash)` is called: also call `portStore.delete(hash)`
- Check where secret is cleaned up: `pod-manager.ts` `terminateSession` → need to verify and add `portStore.delete`

#### Step 5: Port watcher (`packages/opencode-router-plugin/src/port-watcher.ts`)
- New module with `startPortWatcher()`:
  - Reads `OPENCODE_ROUTER_URL`, `OPENCODE_SESSION_HASH`, `OPENCODE_POD_SECRET`
  - If any missing: no-op (same pattern as `pushEvent`)
  - On non-Linux (`process.platform !== "linux"`): no-op (can't read `/proc/net/tcp`)
  - Polls `/proc/net/tcp` every 5s using `Bun.file("/proc/net/tcp").text()`
  - Parses hex ports, filters `> 3000 && != 4096 && <= 65535`
  - Compares with last pushed set; if changed: POST to router
  - On network error: log warning, continue (non-fatal)
  - Returns cleanup function (for testing)
- `packages/opencode-router-plugin/src/index.ts`:
  - Import and call `startPortWatcher()` inside `RouterPlugin`, alongside `setTimeout(() => runStartupReplay(...), 5_000)`

#### Step 6: Operator — replace exec polling with router poll
- `deployment/opencode-cloudflare-operator/src/config.ts`:
  - Add `routerAdminSecret: required("ROUTER_ADMIN_SECRET")` — operator uses this to authenticate GET calls
- `deployment/opencode-cloudflare-operator/src/index.ts`:
  - Remove `getPodListeningPorts` (entire function + `k8s.Exec` usage)
  - Remove `k8s.Exec` import (only used by that function)
  - Update `startPodPoller` poll function:
    - Call `GET config.routerServiceUrl/api/sessions/:hash/ports` with `x-admin-secret: config.routerAdminSecret`
    - Parse `{ports: number[]}` response
    - For each new port: call `createIngressRoutes(sessionPortHostname(hash, port))` only (no `createDnsRecord`/`createTunnelRoute`)
  - Update `provisionPort` → rename `provisionPortRoute` and remove Cloudflare calls
  - Remove `PORT_POLL_INTERVAL_MS` export log line update
  - Update `onPodDeleted`: per-port cleanup calls `deleteIngressRoutes` only (no `deleteTunnelRoute`)

#### Step 7: Tests
- **Operator tests** (`deployment/opencode-cloudflare-operator/tests/operator.test.ts`):
  - Remove `getPodListeningPorts` describe block (entire section)
  - Remove `PROC_TCP_CONTENT` constant
  - Remove `Exec: MockExec` from k8s mock (no longer used)
  - Add `ROUTER_ADMIN_SECRET` to operator config mock
  - Add test: operator `startPodPoller` calls `GET .../ports` and provisions IngressRoute-only for new ports
  - Mock `fetch` to handle `GET /api/sessions/:hash/ports` pattern
- **Router tests** (`packages/opencode-router/src/api.test.ts`):
  - Add `portStore` mock (or use real `port-store.ts` — prefer real since no external deps)
  - Add tests for `POST /api/sessions/:hash/ports`:
    - 200 on valid pod-secret + valid ports body
    - 401 on missing/wrong pod-secret
    - 400 on invalid JSON
    - 400 on non-array ports
  - Add tests for `GET /api/sessions/:hash/ports`:
    - 200 returning stored ports (admin-secret auth)
    - 403 on wrong admin-secret (handled in index.ts, not api.ts; may be out of api.test.ts scope)
- **Port watcher tests** (`packages/opencode-router-plugin/src/port-watcher.test.ts`):
  - Test `/proc/net/tcp` parsing
  - Test no-op on non-Linux
  - Test no-op on missing env vars
  - Test only pushes when ports change

#### Step 8: Typecheck + test run
- `bun typecheck` in `packages/opencode-router`
- `bun typecheck` in `packages/opencode-router-plugin`
- `bun typecheck` in `deployment/opencode-cloudflare-operator`
- `bun test` in `packages/opencode-router`
- `bun test` in `packages/opencode-router-plugin`
- `bun test` in `deployment/opencode-cloudflare-operator`

## Implementation Status

All steps completed. Final test results:
- **packages/opencode-router**: 133 pass, 10 fail (all 10 failures pre-existing, none introduced by this change)
- **packages/opencode-router-plugin**: 13 pass, 0 fail
- **deployment/opencode-cloudflare-operator** (vitest): 28 pass, 0 fail (was 24 before; +4 new `fetchSessionPorts` tests)
- Typechecks: router clean, operator clean, plugin has pre-existing errors in unrelated files

### Bug found and fixed during E2E verification
- **Critical bug**: `POST /api/sessions/:hash/ports` was not intercepted before the email auth gate in `index.ts`, causing 401 in production (pods don't have `x-auth-request-email`). Fixed by adding a guard block in `index.ts` for the POST path before the email check (analogous to the existing `isPortsGet` block). Pod-secret auth is still enforced inside `handleApi` — `index.ts` only passes `"pod@localhost"` as the email to bypass the gate.

### Final key decisions captured
- `GET /api/sessions/:hash/ports` gated in `index.ts` with `x-admin-secret` check, routes to `handleApi` with `admin@localhost`
- `POST /api/sessions/:hash/ports` goes through same path as `/progress` — no change to `index.ts` needed; `handleApi` checks pod-secret and ignores email for those routes
- Port filter: `port > 3000 && port !== 4096 && port <= 65535` (applied in api.ts POST handler)
- `portStore.delete(hash)` added to both cleanup sites in pod-manager.ts (idle cleanup ~line 893 and `terminateSession`)
- `fetchSessionPorts` exported from operator `index.ts` to enable unit testing
- Operator `provisionPortRoute` calls only `createIngressRoutes` — no `createDnsRecord`/`createTunnelRoute`
- `hostname.test.ts` `rejects ports <3000` test failure is pre-existing (confirmed by stashing and running baseline)
- Old `deployment/opencode-cloudflare-operator/src/index.test.ts` was deleted (contained outdated interim tests; superseded by `tests/operator.test.ts`)

## Explore
<!-- beads-phase-id: opencode-9.1 -->
### Tasks
<!-- beads-synced: 2026-05-03 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Plan
<!-- beads-phase-id: opencode-9.2 -->
### Tasks
<!-- beads-synced: 2026-05-03 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Code
<!-- beads-phase-id: opencode-9.3 -->
### Tasks
<!-- beads-synced: 2026-05-03 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Commit
<!-- beads-phase-id: opencode-9.4 -->
### Tasks
<!-- beads-synced: 2026-05-03 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

### Commit phase summary

**Code cleanup** (opencode-9.4.1): All modified files scanned for debug output, TODO/FIXME comments, commented-out code, and experimental blocks. None found. `console.warn` calls in `port-watcher.ts` are intentional non-fatal network warnings, not debug artifacts.

**Documentation** (opencode-9.4.2): No separate architecture/design/requirements docs exist for this repo. All decisions and final state documented in this plan file under Key Decisions and Implementation Status.

**Final validation** (opencode-9.4.3): Full test suites pass with zero regressions:
- `packages/opencode-router`: 133 pass / 10 fail (all 10 failures pre-existing, confirmed by baseline)
- `packages/opencode-router-plugin`: 13 pass / 0 fail
- `deployment/opencode-cloudflare-operator` (vitest): 28 pass / 0 fail

**Committed**: `c83b2103c` — `feat: push-from-pod port forwarding — replace exec polling with router-push architecture`

### Post-deployment bug fix (opencode-9.4.4)

**Root cause**: `deployment/homelab/src/index.ts` — the operator sidecar's `env` block was missing `ROUTER_ADMIN_SECRET`. The operator's `config.ts` calls `required("ROUTER_ADMIN_SECRET")` at process start; without the env var the process throws before the health HTTP server ever binds, so the readiness/liveness probe at `/healthz:8080` times out immediately and Kubernetes never marks the container healthy.

**Fix**: Added `ROUTER_ADMIN_SECRET` from `valueFrom.secretKeyRef` pointing at the existing `code-admin-secret` k8s Secret (key `ADMIN_SECRET`) — the same secret already used by the router for `x-admin-secret` auth.

**Committed**: `c1bc674c8` — `fix(deploy): add ROUTER_ADMIN_SECRET to operator sidecar env`

**Decision**: Reuse the existing `adminSecret` k8s Secret rather than creating a new one. The router and operator share the same admin secret value — this is intentional: the operator authenticates to the router as an admin client.

- [x] `opencode-9.4.1` Code cleanup: scan for debug output, TODOs, commented-out code
- [x] `opencode-9.4.2` Documentation review: update plan file final state
- [x] `opencode-9.4.3` Final validation: run full test suite for all 3 packages
