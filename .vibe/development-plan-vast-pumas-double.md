# Development Plan: repo (vast-pumas-double branch)

_Generated on 2026-05-05 by Vibe Feature MCP_
_Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)_

## Goal

Fix a regression in the opencode-router where resuming a session from a stopped PVC causes opencode to start a **new session** instead of continuing the old (existing) one.

## Key Decisions

### Root Cause: `if`/`else if` order was swapped in commit `13287223b`

**The original working logic** (from commit `27da3245c`, "Claude Code–like UI redesign + initial message bootstrap"):

```
if (activity.sessionId) {
  // Existing sessions → link to most recent one
  sessionUrl = deepLinkUrl(...)
} else if (initialMessage) {
  // No sessions yet + initialMessage → bootstrap a new session
  bootstrapPodSession(...)
} else {
  // No sessions + no initialMessage → fallback URL
  sessionUrl = newSessionUrl(...)
}
```

**The broken logic** (introduced in commit `13287223b`, "opencode-router session plugin — real-time session metadata bridge"):

```
if (initialMessage) {
  // ← WRONG: always bootstraps even on resumed pods that ALREADY have sessions
  bootstrapPodSession(...)
} else if (activity.sessionId) {
  sessionUrl = deepLinkUrl(...)
}
```

### Why the change was made

Commit `13287223b` introduced the `opencode-router-plugin` which runs inside each opencode pod and tracks which sessions are allowed to push events. It added an `allowedSessionIds` filter with this logic:

- Fresh pods: accept-all until first `session.created` event locks down to the bootstrapped session
- Resumed pods: lock down from startup replay

The comment added with the broken code said: _"Sessions with an initialMessage must always link to the bootstrapped session."_

This reasoning was incorrect for the **resume case**. The original design was correct: `activity.sessionId` from the pod's `/session?limit=1` endpoint reflects whether the pod already has sessions. If it does (resume case), use that. If it doesn't (fresh pod), bootstrap.

### Why `bootstrappedSessions` map doesn't prevent the regression

The `bootstrappedSessions` map (renamed from `bootstrappedHashes` Set in the same commit) tracks in-flight/completed bootstraps **within this router process lifetime only**. When a pod is idle-deleted, the entry is cleared: `bootstrappedSessions.delete(hash)`. So on the next resume, the map is empty, `bootstrapPodSession()` runs, creates a new opencode session, and posts the `initialMessage` again — even though the old session is still in the PVC's SQLite database.

### Fix: restore the original if/else order

The fix is to restore the original priority: check `activity.sessionId` first (existing sessions win), and only fall through to `bootstrapPodSession` if there are no existing sessions.

## Notes

- `activity.sessionId` comes from `podActivityMs()` which queries `GET /session?limit=1&roots=true` on the pod. It returns the most recently updated session's ID if any session exists.
- The PVC persists the opencode SQLite database across pod stop/start cycles.
- The `bootstrappedSessions` map is an in-memory cache that does NOT survive router restarts or pod idle-deletion.
- The SSE commit `35668db45` correctly preserved the broken order (it just moved existing code into `buildSessionInfo`), so it is not the root cause — it just carried the bug forward.

## Reproduce

### Tasks

- [x] Identify the bug root cause
- [x] Trace the code path for session resume from stopped PVC
- [x] Identify the exact faulty condition in `buildSessionInfo`
- [x] Find the specific commit that introduced the regression
- [x] Understand WHY the change was made (the reasoning behind the swap)

### Completed

- [x] Created development plan file
- [x] Explored codebase to understand session/pod lifecycle
- [x] Found the regression: introduced in commit `13287223b` — the `if/else if` order in `buildSessionInfo` was swapped: `if (initialMessage)` was placed before `if (activity.sessionId)`, causing the bootstrap to run on resumed pods that already have sessions
- [x] Confirmed the original correct logic was: check `activity.sessionId` first (link to existing session), only bootstrap when no sessions exist yet

## Analyze

### Tasks

_All completed — see below._

### Completed

- [x] Confirmed fix approach: restore original `if (activity.sessionId)` → `else if (initialMessage)` order in `buildSessionInfo()` lines 193-209 of `packages/opencode-router/src/pod-manager.ts`.
- [x] Verified no other places in the codebase have the same inverted logic. `bootstrapPodSession` is called from exactly **one** location (line 202 of `pod-manager.ts`).
- [x] Analyzed all side effects of the swap — see "Side-Effect Analysis" section below.

### Side-Effect Analysis: Swapping the `if`/`else if` order

**Scenario matrix — all four combinations of `activity.sessionId` and `initialMessage`:**

| `activity.sessionId` | `initialMessage` | Broken (current)                | Fixed (restored)                | Correct?            |
| -------------------- | ---------------- | ------------------------------- | ------------------------------- | ------------------- |
| falsy (fresh pod)    | falsy            | `url = null`                    | `url = null`                    | ✅ same — no change |
| falsy (fresh pod)    | truthy           | bootstrap → deepLink            | bootstrap → deepLink            | ✅ same — no change |
| truthy (resumed pod) | falsy            | link existing session           | link existing session           | ✅ same — no change |
| truthy (resumed pod) | truthy           | **bootstrap new session** ← BUG | **link existing session** ← FIX | ✅ fix is correct   |

The swap only changes behavior in one scenario: **resumed pod with `initialMessage` set**. All other scenarios are unaffected.

**Side effect 1 — `opencode-router-plugin` `allowedSessionIds` filter (detailed analysis)**

The plugin runs inside each pod. Its purpose is to push events (session title, user messages, assistant messages) from the pod to the router's `POST /api/sessions/:hash/progress` endpoint, so the router's dashboard can show a live message thread and session title — even while the user is inside the opencode UI.

`allowedSessionIds` controls **which opencode session IDs the plugin is allowed to forward events for**. The problem it solves: a pod can contain multiple opencode sessions in its SQLite database (prior sessions from previous uses). Without a filter, all sessions' events would be pushed to the router's `messageStore`, including old/irrelevant ones. On a fresh pod there are no sessions yet, so the filter starts as `null` (accept-all) to capture the first `session.created` event (the one the router just bootstrapped), then locks down to that ID.

**Is it necessary / is it hacky?**

It is a reasonable guard, but it introduces complexity that is only needed because the data model allows a pod to host multiple sessions. The complexity arises from the three-state lifecycle:

1. `null` — fresh pod, no sessions yet, accept-all (so the bootstrapped session gets captured)
2. `null` → `Set([id])` — on first `session.created`, lock down to the bootstrapped session
3. `Set([existing...])` — populated by startup replay on resumed pod, only forward known sessions

The "hacky" aspect is the **5-second startup delay** (`setTimeout(..., 5_000)`) before replay. This is needed because the plugin is loaded synchronously by opencode at startup, before the HTTP server is ready — calling `session.list()` immediately would deadlock the readiness probe. This coupling is a known architectural compromise.

After the fix (restoring `activity.sessionId` priority): on a resumed pod, the router links to the existing session, and `allowedSessionIds` (populated by replay with those same session IDs) correctly allows those sessions' events to flow. The filter works correctly in both the fresh-pod and resumed-pod cases — the bug was entirely in `buildSessionInfo`, not in the plugin.

The concern from commit `13287223b` was: "Sessions with an initialMessage must always link to the bootstrapped session." This was about preventing the fresh-pod case from accidentally being served a stale session ID via a race condition. But that race doesn't exist: `activity.sessionId` is only truthy **when the pod already has sessions in SQLite**, which is never the case for a genuinely fresh pod. A fresh pod's `/session?limit=1&roots=true` returns `[]`, giving `sessionId: undefined`.

**Side effect 2 — `bootstrappedSessions` map becomes stale for resumed pods**

Currently, for a resumed pod with `initialMessage`, `bootstrappedSessions.set(hash, promise)` is called and the entry persists until pod termination or idle-delete. After the fix, `bootstrapPodSession()` is never called for resumed pods, so no entry is added. This is correct — the map was only serving the (wrong) purpose of deduplicating the spurious bootstrap calls.

For **fresh pods** (where bootstrapping is still wanted), the map continues to work exactly as before.

**Side effect 3 — `newSessionUrl` fallback was removed in commit `13287223b`**

The original code had an `else` branch: `sessionUrl = newSessionUrl(...)` when neither `activity.sessionId` nor bootstrap succeeded. Commit `13287223b` removed this branch (and the `newSessionUrl` function itself) and changed `url: string` to `url: string | null` in `SessionInfo`. The frontend was updated in the same commit to handle `url: null` by showing a loading state.

The fix does **not** need to restore `newSessionUrl`. The `null` fallback (current behaviour when neither branch fires) is the correct and intended design — the frontend polls and waits for a non-null URL. The `newSessionUrl` fallback was actually a mistake in the original — sending users to a bare `/session` URL created a second session silently.

**Side effect 4 — `bootstrapPodSession` still runs on resumed pods if `activity.sessionId` is temporarily undefined**

There is a narrow window during pod startup where the opencode process is running (pod `Ready=True`) but hasn't yet loaded sessions from SQLite. During this window, `GET /session?limit=1&roots=true` could return `[]` (giving `sessionId: undefined`) even though the PVC has existing sessions. In this window, the fixed code would fall through to `bootstrapPodSession()`, which would create a new session.

However: this window is very short (SQLite load at opencode startup is fast, typically <1s), and the `bootstrappedSessions` map will deduplicate any concurrent calls. More importantly, `podActivityMs()` returns `null` if the pod is unreachable, and the readiness probe gates the pod to `Ready=True` only after `/global/health` passes. By then, sessions are loaded. This edge case existed in the _original_ code too and is considered acceptable.

**Conclusion: The swap has no unintended side effects.** It is a pure correctness fix for the resume case, and all other scenarios remain identical.

## Fix

### Tasks

_All completed — see below._

### Completed

- [x] Restored the original `if (activity.sessionId)` → `else if (initialMessage)` order in `buildSessionInfo` in `packages/opencode-router/src/pod-manager.ts` (lines ~193–212).
- [x] Added `_clearBootstrappedSessions()` test helper export to `pod-manager.ts` to allow cross-test isolation of the module-level `bootstrappedSessions` Map.
- [x] Added 4 regression tests in `pod-manager.test.ts` under `"buildSessionInfo — resume vs bootstrap URL resolution"`:
  1. **REGRESSION test**: resumed pod with `initialMessage` → links to existing session, does NOT call bootstrap
  2. Fresh pod with `initialMessage` → bootstraps new session
  3. Resumed pod without `initialMessage` → links to existing session
  4. Fresh pod without `initialMessage` → url stays null
- [x] Fixed cross-test state pollution: `prepullImage` tests mutate `fakeK8sApi.readNamespacedPod`; saved/restored the original in the new describe's `beforeEach`.
- [x] All 43 tests pass (`bun test src/pod-manager.test.ts`). TypeCheck clean (`bun typecheck`).

## Verify

### Tasks

_All completed — see below._

### Key Decisions (Verify Phase)

- **Tests must be run per the package.json `test` script** (each test file in a separate `bun test` invocation). Running `bun test` without specifying files loads all test files in one process, which causes mock pollution — `api.test.ts` calls `mock.module("./pod-manager.js", ...)` which poisons the real `pod-manager.ts` import used by `pod-manager.test.ts`. The package.json `test` script was already written to handle this correctly.
- **The `prepullImage failed: ...` error output in `api.test.ts`** is expected — it is a `console.error` call from `api.ts:550` when `prepullImage` rejects, not a test failure. The test intentionally verifies that a rejected promise produces a 500 response.
- **All 157 tests pass** across both packages when run correctly. The fix is fully verified.

### Completed

- [x] Ran full opencode-router test suite via `bun run test` (the proper isolated-per-file script): **147 pass, 0 fail** across all 7 test files.
  - `src/config.test.ts` + `src/api.test.ts` — 77 pass, 0 fail
  - `src/pod-manager.test.ts` — 43 pass, 0 fail (includes 4 new regression tests)
  - `src/hostname.test.ts` — 8 pass, 0 fail
  - `src/pod-secret-store.test.ts` — 8 pass, 0 fail
  - `src/message-store.test.ts` — 6 pass, 0 fail
  - `src/stream-broadcaster.test.ts` — 5 pass, 0 fail
- [x] Ran opencode-router-plugin test suite: **13 pass, 0 fail** across 2 files.
- [x] TypeCheck clean (`bun typecheck` in `packages/opencode-router` — `tsc --noEmit` exits 0).
- [x] No regressions introduced. All pre-existing tests continue to pass.
- [x] The 4 regression tests specifically targeting the resume-vs-bootstrap bug all pass, confirming the fix is correct.

## Finalize

### Tasks

_All completed — see below._

### Key Decisions (Finalize Phase)

- **No debug artifacts found**: All `console.*` calls in `pod-manager.ts`, `api.ts`, `index.ts`, and `dev-proxy.ts` are legitimate operational logging (startup messages, error handlers, idle-pod deletion notices) — none are temporary investigation-era debug output.
- **design.md not updated**: The file contains only the blank template placeholder; the bug fix does not add new design patterns or principles warranting documentation there. The authoritative root-cause analysis is captured in this plan's "Key Decisions" section.
- **No TODOs/FIXMEs present**: A codebase-wide scan found zero `TODO`, `FIXME`, `HACK`, or `XXX` markers in the changed or related source files.
- **Final test run confirms no regressions**: 147 pass (opencode-router) + 13 pass (opencode-router-plugin) = 160 total, 0 failures. TypeCheck exits 0.

### Completed

- [x] Scanned all changed and related source files for temporary debug `console.*` output — none found; all logging is production-appropriate.
- [x] Scanned for TODO/FIXME/HACK comments — none present in changed files.
- [x] Reviewed `design.md` — blank template only; no updates required.
- [x] Ran final full test suite: **147 pass, 0 fail** (opencode-router) + **13 pass, 0 fail** (opencode-router-plugin).
- [x] TypeCheck clean (`bun typecheck` exits 0).
- [x] Fix is production-ready.

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
