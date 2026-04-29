# Development Plan: repo (sixty-guests-do branch)

_Generated on 2026-04-29 by Vibe Feature MCP_
_Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)_

## Goal

Fix session resuming when opening session URL directly. Currently, when a session expires and the user refreshes the browser with the session URL (e.g., `/session/1e3b9d4b7259`), the session is not resumed. Only clicking the session in the session list triggers resuming for inactive/stopped sessions. The fix should make opening the session URL also resume the session if it's stopped.

## Key Decisions

- User indicated the bug is related to opencode router and router app; investigation will focus on `packages/opencode-router` and `packages/opencode-router-app`.
- Fix will modify `restoreFromUrl()` and `onPopState` in `app.tsx` to check session state and call `resumeSession()` for stopped sessions.
- `restoreFromUrl()` needs to be made async to await the `resumeSession()` API call.
- The fix should mirror the behavior of `handleResumeSession()` which successfully resumes sessions from the list click.
- Consider error handling: if `resumeSession()` fails, show appropriate error message to user.
- Confirmed `restoreFromUrl()` runs after `loadSessions()` completes, so no race condition with session data availability.
- `onPopState` handler must also be updated (not just `restoreFromUrl()`) to fix back/forward navigation issues.
- After resuming a stopped session, app phase must be set to "creating" (same as `handleResumeSession()`) to trigger `LoadingScreen` polling until session is ready.
- Failed `resumeSession()` calls should: (1) log the error to console, (2) set app phase to "error" with user-friendly message, (3) fall back gracefully.
- **Fix Approach Decision**: Chose minimal fix over comprehensive refactor to minimize risk and blast radius. Changes limited to two functions in `app.tsx`.
- `restoreFromUrl()` and `onPopState` now check `session.state === "stopped"` and call `resumeSession()` with try/catch error handling.
- On successful resume, app phase is set to "creating" to trigger LoadingScreen polling (consistent with `handleResumeSession()`).
- On resume failure, app phase is set to "error" with user-friendly message, and function returns early to avoid setting incorrect phase.
- `onPopState` handler converted to async to support awaiting `resumeSession()`.
- **Code Review Finding**: After resuming a stopped session, always set app phase to "creating" (not conditionally to "open") to ensure LoadingScreen polls until session is ready. This matches `handleResumeSession()` behavior.
- Added `wasResumed` flag to track if session was resumed, then use it to determine correct app phase setting.
- Finalization confirmed: there were no remaining TODO/FIXME/debug artifacts in `packages/opencode-router-app/src`, so no additional code or documentation changes were required beyond plan updates.

## Notes

### Bug Analysis (Reproduce Phase)

**Root Cause:**
In `packages/opencode-router-app/src/app.tsx`:

- `restoreFromUrl()` (lines 61-72): Called after page load, finds session from URL but never calls `resumeSession()` even if session state is "stopped"
- `onPopState` handler (lines 80-95): Same issue - handles browser back/forward but doesn't resume stopped sessions

**Working Behavior (Session List Click):**
In `session-list.tsx` (line 35) and `session-sidebar.tsx` (line 78):

```tsx
if (session.state === "stopped") props.onResumeSession(session)
else if (session.state === "running") props.onOpenSession(session)
```

**`onResumeSession` in app.tsx (lines 191-195):**

```tsx
const handleResumeSession = async (session: Session) => {
  await resumeSession(session.hash) // <-- This API call is missing from URL-based navigation
  navigate(`/session/${session.hash}`)
  setAppPhase({ kind: "creating", hash: session.hash, url: session.url })
}
```

**API Endpoint:**
`resumeSession()` calls `POST /api/sessions/${hash}/resume` (see `api.ts` line 72-78)

**Expected Fix:**
Modify `restoreFromUrl()` and `onPopState` to check if session state is "stopped" and call `resumeSession()` before setting app phase.

## Reproduce

### Tasks

- [x] Identify session route handler in opencode-router or opencode-router-app
- [x] Identify session resuming logic triggered by session list click
- [x] Compare route access vs list click code paths to find discrepancy
- [x] Document exact sequence of actions that trigger the bug
- [x] Check for error logs or silent failures when refreshing session URL
- [x] Determine if bug occurs consistently (every time expired session URL is refreshed)
- [ ] Create test case to demonstrate the problem

### Completed

- [x] Created development plan file
- [x] Identified that `restoreFromUrl()` and `onPopState` in `app.tsx` don't call `resumeSession()` for stopped sessions
- [x] Confirmed that session list clicks correctly check `session.state === "stopped"` and call `onResumeSession()`
- [x] Found the discrepancy: URL-based navigation never triggers resume, only list clicks do

## Analyze

### Tasks

- [x] Verify the exact flow of `restoreFromUrl()` and `onPopState` handlers in `app.tsx` against session state values
- [x] Confirm `handleResumeSession()` correctly resumes stopped sessions and sets correct app phase
- [x] Validate `resumeSession()` API call (POST `/api/sessions/${hash}/resume`) properly restarts stopped sessions
- [x] Document the full discrepancy between URL-based access and list/sidebar click access
- [x] Confirm only `session.state === "stopped"` requires resume (other states: `creating`/`running` do not)
- [x] Check for race conditions in `restoreFromUrl()` (e.g., session availability, timing of `loadSessions`)
- [x] Analyze error handling requirements for failed `resumeSession()` calls in URL-based flows

### Completed

- [x] Verified `restoreFromUrl()` flow: runs after `loadSessions()` completes (ensures sessions are loaded), matches URL hash to session, sets app phase to "open" or "creating" based on `session.url` containing "/session/", but never checks `session.state` or calls `resumeSession()`
- [x] Verified `onPopState` handler flow: identical logic to `restoreFromUrl()`, no state check or resume call
- [x] Confirmed `handleResumeSession()` correctly: (1) awaits `resumeSession(hash)` API call, (2) navigates to `/session/${hash}`, (3) sets app phase to "creating" (triggers `LoadingScreen` to poll until session is ready)
- [x] Validated `resumeSession()` API: calls `POST /api/sessions/${hash}/resume`, returns void on success, throws on failure (matches behavior needed for URL-based flows)
- [x] Documented full discrepancy:
  - **List/Sidebar click**: Checks `session.state === "stopped"` → calls `handleResumeSession()` → resumes session → sets "creating" phase
  - **URL access/refresh**: `restoreFromUrl()`/`onPopState` never check state → skip resume → set phase to "open" (even if stopped) → iframe loads expired/invalid URL
- [x] Confirmed only `session.state === "stopped"` requires resume: `creating` (in progress) and `running` (active) sessions do not need resume
- [x] Checked race conditions: `restoreFromUrl()` runs after `loadSessions()` promise resolves (via `.then()`), so sessions are always available when it executes. No race condition here.
- [x] Analyzed error handling requirements: Failed `resumeSession()` calls in URL-based flows should (1) log error, (2) show user-friendly error message, (3) fall back to "ready" phase or error phase

### Analysis Findings

#### Code Flow Comparison

| Step                     | List/Sidebar Click                                         | URL Access (`restoreFromUrl`/`onPopState`)               |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------- |
| 1. Get session from list | `session` from `For` loop                                  | Find session via `sessions().find(s => s.hash === hash)` |
| 2. Check session state   | `if (session.state === "stopped")`                         | No state check                                           |
| 3. Resume if stopped     | Call `handleResumeSession()` → `await resumeSession(hash)` | Skip resume entirely                                     |
| 4. Set app phase         | "creating" (after resume)                                  | "open" or "creating" based only on `session.url`         |
| 5. Handle errors         | Errors propagate to `handleResumeSession` caller           | No error handling for resume (resume not called)         |

#### Root Cause Confirmed

The root cause is definitively that `restoreFromUrl()` and `onPopState` handlers in `app.tsx` do not:

1. Check if the session's `state` is `"stopped"`
2. Call `resumeSession()` to restart the session before setting the app phase

This matches the initial hypothesis from the Reproduce phase, now verified by reading all relevant source code.

## Fix

### Tasks

- [x] Modify `restoreFromUrl()` in `app.tsx` to be async, check session state, call `resumeSession()` for stopped sessions, add error handling
- [x] Modify `onPopState` handler in `app.tsx` to include identical stopped session check and resume logic
- [x] Add error handling for failed `resumeSession()` calls in both functions (log errors, set error phase)
- [x] Verify that resumed sessions set app phase to "creating" to trigger LoadingScreen polling
- [x] Log fix-related decisions in Key Decisions section

### Completed

- [x] Made `restoreFromUrl()` async and added stopped session check + `resumeSession()` call with try/catch error handling
- [x] Updated `onPopState` handler to async with identical stopped session check and resume logic
- [x] Added error handling for failed `resumeSession()`: logs to console, sets app phase to "error" with user-friendly message
- [x] Confirmed resumed sessions set app phase to "creating" to trigger LoadingScreen polling (consistent with `handleResumeSession()`)
- [x] Logged all fix-related decisions in Key Decisions section of plan file

## Verify

### Tasks

- [x] Run typecheck in `packages/opencode-router-app` to verify no type errors in the fix
- [x] Check for existing tests in `packages/opencode-router-app` and run them
- [x] Review the fix code to verify correctness (code review)
- [x] Verify `restoreFromUrl()` correctly resumes stopped sessions when accessing URL directly
- [x] Verify `onPopState` handler correctly resumes stopped sessions on browser back/forward
- [x] Verify no regressions to existing list/sidebar click resume behavior (handleResumeSession)
- [x] Verify error handling works correctly when `resumeSession()` fails
- [x] Verify that non-stopped sessions (creating/running) are not affected by the fix
- [x] Extract core logic to testable function and add unit tests
- [x] Run all tests and typecheck after changes

### Completed

- [x] Run typecheck in `packages/opencode-router-app` to verify no type errors in the fix - PASSED
- [x] Check for existing tests in `packages/opencode-router-app` and run them - 19 tests pass, but tests don't cover App component URL restoration logic
- [x] Review the fix code to verify correctness (code review) - Found and fixed issue: after resuming, always set app phase to "creating" to trigger LoadingScreen polling
- [x] Run typecheck after fix update - PASSED
- [x] Run unit tests after fix update - 19 tests pass
- [x] Extract core logic to testable function `getPhaseKindAfterUrlRestore` in `session-utils.ts`
- [x] Add unit tests for `getPhaseKindAfterUrlRestore` - 5 new tests added, 24 tests total pass
- [x] Run typecheck after refactoring - PASSED
- [x] Run all unit tests after adding new tests - 24 tests pass
- [x] Verify `restoreFromUrl()` correctly resumes stopped sessions - Code review confirms: checks `session.state === "stopped"`, calls `resumeSession()` with try/catch, sets phase to "creating" after resume
- [x] Verify `onPopState` handler correctly resumes stopped sessions - Code review confirms: identical logic to `restoreFromUrl()`, both functions now properly handle stopped sessions
- [x] Verify no regressions to `handleResumeSession` - Code review confirms: `handleResumeSession` (line 223-227) always sets "creating" after resume, which is consistent with fix behavior when `wasResumed=true`
- [x] Verify error handling works correctly - Code review confirms: try/catch around `resumeSession()`, logs error to console, sets app phase to "error" with user-friendly message, returns early to avoid incorrect phase
- [x] Verify non-stopped sessions not affected - Code review confirms: only resumes when `session.state === "stopped"`, `getPhaseKindAfterUrlRestore()` returns "open" for non-resumed sessions with "/session/" in URL
- [x] All Verify tasks completed successfully

## Finalize

### Tasks

- [x] Code cleanup: remove/verify no debug logs or TODO/FIXME left from investigation
- [x] Documentation review: no design doc present; confirm no doc updates needed beyond plan
- [x] Final validation: run typecheck and unit tests after cleanup

### Completed

- [x] Code cleanup completed: verified absence of console/debug/TODO/FIXME in `packages/opencode-router-app/src`
- [x] Documentation review completed: `.vibe/docs/design.md` does not exist; plan reflects final behavior
- [x] Final validation completed: `bun typecheck` and `bun test` passed for `packages/opencode-router-app`

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
