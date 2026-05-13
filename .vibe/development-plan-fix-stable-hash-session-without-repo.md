# Development Plan: opencode (fix/stable-hash-session-without-repo branch)

*Generated on 2026-05-13 by Vibe Feature MCP*
*Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)*

## Goal
Fix: when creating a new session without a repo, the session hash must be stable — the same hash must be used for the PVC, the Pod, and returned to the client. Currently `getSessionHash` uses `crypto.randomUUID()` for no-repo sessions, so each call produces a different hash, causing the Pod to reference a PVC that doesn't exist.

## Key Decisions

### Decision 1: Hash must be purely internal to pod-manager.ts
Exposing the hash on `SessionKey` was rejected because a malicious consumer could pass an arbitrary hash and target another user's PVC. The hash must be computed and frozen **inside** `pod-manager.ts`, never on the public `SessionKey` interface.

### Decision 2: Introduce an internal `startSession` function in pod-manager.ts
Rather than changing `ensurePVC`/`ensurePod` signatures, expose a single `startSession(session, githubToken?)` function that:
1. Calls `getSessionHash` exactly **once**
2. Passes the frozen hash internally to both `ensurePVC` and `ensurePod` (via a private helper overload or by refactoring to accept a hash internally)
3. Returns the hash to the caller

`api.ts` calls `startSession` instead of calling `ensurePVC` + `ensurePod` + `getSessionHash` separately.

### Decision 3: Make hash the first required parameter of `ensurePVC` and `ensurePod`
The hash is now the primary identity input — `ensurePVC(hash, session)` and `ensurePod(hash, session, githubToken?, image?)`. Callers always compute the hash before calling, which makes it impossible to silently get a mismatched hash. The `_hash?: string` optional hack was rejected in favour of this cleaner contract. All callers (both in `pod-manager.ts` and `api.ts`) and all tests were updated accordingly.

### Decision 5: `SessionKey` stays as the data parameter — repo info IS needed
`ensurePVC` uses `repoUrl`/`branch`/`sourceBranch`/`initialMessage` purely for PVC annotations (so `resumeSession` can reconstruct the session later). `ensurePod` uses `repoUrl`/`branch`/`sourceBranch` functionally to build the correct init script (`git clone` vs `git init`). Removing them from these functions would either require a separate annotation-writing step or duplicate the git-decision logic elsewhere. The `SessionKey` struct is the correct abstraction: **hash = identity, SessionKey = data**. No further simplification needed.

### Decision 4: `api.ts` git-repo and no-repo paths updated consistently
- **Git-repo path**: still calls `getSessionHash` → `ensurePVC(hash, session)` → `ensurePod(hash, session, githubToken)` directly, since the hash is deterministic.
- **No-repo path**: calls `startSession(session, githubToken)` which freezes the random hash once internally and passes it to both `ensurePVC` and `ensurePod`.
- Both paths now make the hash explicit at the call site, which is the root-cause fix.

## Notes
*Additional context and observations*

### Root Cause (confirmed)
- File: `packages/opencode-router/src/pod-manager.ts`, function `getSessionHash` (line ~335)
- For no-repo sessions: `crypto.randomUUID()` is called each time → different hash per call
- In `api.ts` (lines 179–182), `getSessionHash` is called 3 times independently:
  - Line 179: `const hash = getSessionHash(email)` → H1 (returned to client)
  - Inside `ensurePVC`: `getSessionHash(session.email, ...)` → H2 (used for PVC name)
  - Inside `ensurePod`: `getSessionHash(session.email, ...)` → H3 (used for Pod name + PVC claim)
- H1 ≠ H2 ≠ H3 → Pod mounts wrong PVC, client polls wrong hash

### Why git-repo path is unaffected
- Deterministic hash: `sha256(email:repoUrl:branch)` — same inputs always yield same hash
- Multiple calls produce identical results

## Reproduce
<!-- beads-phase-id: opencode-11.1 -->
### Tasks
<!-- beads-synced: 2026-05-13 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-11.1.1` Confirm: getSessionHash called 3x independently in no-repo path → 3 different hashes

## Analyze
<!-- beads-phase-id: opencode-11.2 -->
### Tasks
<!-- beads-synced: 2026-05-13 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Fix
<!-- beads-phase-id: opencode-11.3 -->
### Tasks
<!-- beads-synced: 2026-05-13 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-11.3.1` Write failing regression test: PVC and Pod share same hash for no-repo session
- [x] `opencode-11.3.2` Refactor ensurePVC and ensurePod to accept optional pre-computed hash
- [x] `opencode-11.3.3` Expose startSession in pod-manager.ts that calls getSessionHash once
- [x] `opencode-11.3.4` Update api.ts to call startSession instead of 3 separate calls
- [x] `opencode-11.3.5` Run tests and type check

## Verify
<!-- beads-phase-id: opencode-11.4 -->
### Tasks
<!-- beads-synced: 2026-05-13 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Finalize
<!-- beads-phase-id: opencode-11.5 -->
### Tasks
<!-- beads-synced: 2026-05-13 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

