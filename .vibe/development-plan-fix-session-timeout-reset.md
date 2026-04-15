# Development Plan: opencode (fix-session-timeout-reset branch)

_Generated on 2026-04-14 by Vibe Feature MCP_
_Workflow: [bugfix](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/bugfix)_

## Goal

Session pods get killed after the idle timeout even when the session is actively in use. The timeout should be reset whenever activity happens in the session. Additionally, the **UI countdown** showing "stops in ~Xm" is wrong for active sessions because it reads from the same stale annotation.

## Key Decisions

### Decision 1: Track activity at the opencode session level, not at the WebSocket proxy level

**Original approach (current/broken):** `updateLastActivity(hash)` is called on every HTTP request and WebSocket _upgrade_ in the router. This misses all activity that happens over a long-lived WebSocket connection — which is exactly how opencode AI sessions work. Once the WS is established, the router sees no further HTTP traffic even while the AI is actively running.

**Proposed approach (higher abstraction):** Instead of watching proxy-level events, the router should periodically **poll `GET /experimental/session?limit=1`** on each running pod. This endpoint returns the most recently touched session across the whole opencode instance, sorted by `time.updated` (Unix ms). `Session.touch()` is called in opencode whenever a real prompt is processed, so `time.updated` accurately reflects genuine user activity — independent of transport (WebSocket, HTTP, CLI, etc.).

**Why this is better:**

- No WS introspection needed at all
- Reflects actual user activity (prompt sent/AI running), not just connection presence
- Handles multiple tabs, CLI usage, ACP agents — any path that calls `Session.touch()`
- `/experimental/session?limit=1` works without knowing the project directory
- The router already knows the pod IP, so it can make this HTTP call

**Trade-offs / risks:**

- Adds an HTTP call from the router into each running pod (once per cleanup cycle = every 60s)
- Couples the router to the opencode API shape (`/experimental/session`)
- Pod must be Running and healthy for the check to work; if unreachable, fall back to annotation

### Decision 2: `lastActivity` must be authoritative for BOTH deletion AND UI countdown

The `lastActivity` field on `SessionInfo` serves two purposes:

1. **Idle pod deletion:** `deleteIdlePods()` in `pod-manager.ts` compares the K8s annotation `opencode.ai/last-activity` to `now - idleTimeoutMinutes` to decide whether to delete a pod.
2. **UI countdown display:** `computeIdleStatus()` in `session-utils.ts` computes "stops in ~Xm" from `lastActivity` and `idleTimeoutMinutes`. The UI polls `GET /api/sessions` every 5 seconds (see `app.tsx:46`) and re-renders the countdown from the returned `lastActivity`.

Both are broken together: if `lastActivity` on the pod annotation is stale, the pod gets deleted AND the countdown shows the wrong remaining time. The fix must keep the annotation accurate so both consumers get correct data.

**The fix therefore has two parts:**

1. **During `deleteIdlePods()`:** before deciding to delete a pod, poll the pod's `/experimental/session?limit=1` endpoint; if `time.updated` is within the idle window, update the K8s annotation with that timestamp and skip deletion.
2. **During `listUserSessions()` (called by `GET /api/sessions`):** for running pods, poll the same endpoint and use `max(annotation, session.time.updated)` as the authoritative `lastActivity` returned to the UI.

### Decision 3: Reproduce via a failing test in pod-manager.test.ts

The failing test must demonstrate:

1. A running pod with a stale `last-activity` annotation (older than the idle timeout)
2. The opencode instance inside that pod reports recent session activity via `/experimental/session?limit=1`
3. `deleteIdlePods()` currently **deletes** the pod anyway (bug confirmed)
4. After the fix, `deleteIdlePods()` must **preserve** the pod and update the annotation

A second failing test:

1. A running pod with a stale `last-activity` annotation
2. The opencode instance reports recent session activity
3. `listUserSessions()` currently returns the stale annotation as `lastActivity` (bug: UI shows wrong countdown)
4. After the fix, `listUserSessions()` returns `time.updated` from the pod's session as `lastActivity`

This requires a new injectable `_setActivityFetch` in `pod-manager.ts` (same pattern as existing `_setFetch` used for `remoteBranchExists`) so tests can mock HTTP calls to the opencode instance.

## Notes

- `Session.touch()` is called in `src/session/prompt.ts:1280` — whenever a prompt is processed
- `GET /experimental/session?limit=1` returns `Session.GlobalInfo[]` sorted by `time.updated` desc — no `directory` param needed
- The idle cleanup interval is 60s; `updateLastActivity` throttle is also 60s — polling cadence fits naturally
- The UI polls `GET /api/sessions` every 5s (`app.tsx:46`) and calls `computeIdleStatus()` with the returned `lastActivity`
- `computeIdleStatus()` is in `session-utils.ts` — pure function, no changes needed there; fixing the source data is enough
- `updateLastActivity` sets the throttle **before** the async patch — if the patch fails silently, retries are blocked for 60s. Secondary bug, out of scope for this fix.

## Data flow (current — broken)

```
User active in AI session (WS open, prompts running)
    │
    │  Session.touch() called inside pod → time.updated = now
    │  (invisible to router)
    │
Router: HTTP request arrives → updateLastActivity() → K8s annotation updated
    │
    │  (no more HTTP requests come — WS is long-lived)
    │
    ▼
After 15 min: deleteIdlePods() checks annotation → annotation is stale → POD DELETED ✗
              listUserSessions() returns stale annotation → UI shows wrong countdown ✗
```

## Data flow (proposed — fixed)

```
User active in AI session
    │
    │  Session.touch() → time.updated = now (inside pod)
    │
Every 60s: deleteIdlePods() / listUserSessions()
    │   → polls GET /experimental/session?limit=1 on each running pod's IP
    │   → gets sessions[0].time.updated = now
    │   → updates K8s annotation with time.updated
    │   → skips deletion (within idle window)
    │   → returns accurate lastActivity to UI ✓
    ▼
UI countdown is correct; pod is preserved ✓
```

## Reproduce

<!-- beads-phase-id: opencode-4.1 -->

### Tasks

<!-- beads-synced: 2026-04-14 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Analyze

<!-- beads-phase-id: opencode-4.2 -->

### Tasks

<!-- beads-synced: 2026-04-14 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Fix

<!-- beads-phase-id: opencode-4.3 -->

### Tasks

<!-- beads-synced: 2026-04-14 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Verify

<!-- beads-phase-id: opencode-4.4 -->

### Tasks

<!-- beads-synced: 2026-04-14 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Finalize

<!-- beads-phase-id: opencode-4.5 -->

### Tasks

<!-- beads-synced: 2026-04-14 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
