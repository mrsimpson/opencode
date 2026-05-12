# Development Plan: opencode (fix/new-project-session-creation branch)

*Generated on 2026-05-12 by Vibe Feature MCP*
*Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)*

## Goal
Fix new-project (no-repo) session creation: pods fail to schedule because the PVC is not found.
`getSessionHash()` for new projects uses `crypto.randomUUID()`, which generates a different value on each call.
`ensurePVC` and `ensurePod` each called it independently, producing different hashes — the PVC was created
under one hash while the pod claimed a PVC named after a completely different hash.

## Key Decisions

### Fix approach: pre-compute hash once; pass as `SessionKey.hash`
- Added optional `hash?: string` field to `SessionKey` in `pod-manager.ts`
- `ensurePVC` and `ensurePod` now use `session.hash ?? getSessionHash(...)` — honouring the pre-computed hash when provided
- In `api.ts` (backend) new-project path: compute `hash = getSessionHash(email)` once, embed it in the `SessionKey` before calling `ensurePVC`/`ensurePod`
- Git-backed sessions (deterministic hash) are unaffected — `getSessionHash` returns same value on each call for them
- `prepullImage` is unaffected — uses a deterministic key (email + fixed repoUrl + branch)

### Frontend: `SessionSchema` — `repoUrl`/`branch`/`sourceBranch` made optional with default `""`
- Backend `buildSessionInfo` already returns `""` for new-project sessions (no Zod failure), but making them
  optional with default `""` makes the schema accurately reflect the data model and is safer for future changes

### No blast radius concerns
- Change is backward compatible: `session.hash` is optional; existing callers that don't set it fall back to `getSessionHash()`
- Zero new test failures introduced (12 pre-existing failures in unrelated tests confirmed identical before/after)

## Notes

### Root cause confirmed (reproduce phase)
- POST `/api/sessions` with `{}` body (new project) returned 201 OK
- Frontend navigated to `/session/<hash>` which showed "session not found"
- Kubernetes error: `persistentvolumeclaim "opencode-pvc-<hash>" not found`
- `getSessionHash(email)` without `repoUrl` uses `crypto.randomUUID()` → different result each call
- `ensurePVC` call 1 → hash A; `ensurePod` call 2 → hash B; pod spec references `pvc-B` which doesn't exist

### Init script fix: idempotency + inline git identity for new-project sessions
- The new-project git phase (`git init` + `git commit`) was not guarded — it re-ran on every pod restart
- On restart: `git add -A` would stage all user work and create an unwanted extra commit; worse, `git commit` required `user.name`/`user.email` to be in global config from the GITHUB_TOKEN block — if that block hadn't flushed yet the commit failed → `set -e` → CrashLoopBackOff
- Fix: wrap the entire new-project git phase in `if [ ! -d /workspace/.git ]` — only runs on first pod start
- Fix: pass git identity inline on the commit command (`git -c user.email="..." -c user.name="..."`) using the session email baked into the init script — this is always available and never depends on the GITHUB_TOKEN block having run successfully
- Removed `git add -A` — a fresh `git init` has nothing to stage; `--allow-empty` handles the empty initial commit correctly
- The user confirmed: GitHub identity (GITHUB_TOKEN) is non-optional for new-project sessions — it flows from the OAuth proxy headers on every authenticated request

### Git identity ordering bug: local repo config written before the repo existed
- The GITHUB_TOKEN block (which sets `GH_NAME`, `GH_LOGIN`, `GH_ID` and writes global gitconfig) ran first
- A previous fix attempted to also write local repo config inside this block: `if [ -d /workspace/.git ]`
- But on **first start** `/workspace/.git` does not exist yet (git init runs in the block below) — the guard was false → local config write silently skipped
- On pod restarts the repo existed so local config WAS written — explaining why resume worked but first start didn't
- Fix: move the local repo config write to **after the git phase** (after both the clone and git-init blocks), guarded by `$GH_NAME` being set AND `/workspace/.git` existing — guaranteed to run correctly on first start and restarts

### Resume path: new-project sessions got a new random hash on every resume
- `resumeSession` rebuilt `SessionKey` from PVC annotations but did not include `hash`
- `ensurePod` then called `getSessionHash(email)` with no `repoUrl` → `crypto.randomUUID()` → new hash
- Pod was created under the new hash; its PVC claim referenced `opencode-pvc-<new-hash>` which didn't exist
- Fix: add `hash` to the `SessionKey` built in `resumeSession` (same pattern as the creation path fix)

### Git identity not propagated to opencode's working environment
- The `GITHUB_TOKEN` block in the init script writes `~/.gitconfig` (global config) via `git config --global`
- The global config is stored on the PVC at `/home/opencode/.gitconfig` and is visible to the main container
- However, the repo's local `.git/config` had no identity — `git config user.name` inside the repo returned empty
- Fix: after setting global config, also write the same identity into the repo's local config via `git -C /workspace config user.name/email` — this is scoped to the repo and guaranteed visible to opencode running in that directory

### Files changed
- `packages/opencode-router/src/pod-manager.ts` — `SessionKey.hash?`, `ensurePVC`, `ensurePod`, init script idempotency + inline identity
- `packages/opencode-router/src/api.ts` — new-project path pre-computes hash once
- `packages/opencode-router/src/pod-manager.test.ts` — regression tests updated to verify idempotency guard and inline identity
- `packages/opencode-router-app/src/api.ts` — `SessionSchema` fields optional

## Reproduce
<!-- beads-phase-id: opencode-10.1 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-10.1.1` Fix: new-project session fails because getSessionHash() re-generates random hash on each call

## Analyze
<!-- beads-phase-id: opencode-10.2 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Fix
<!-- beads-phase-id: opencode-10.3 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-10.3.1` Add optional hash field to SessionKey; use it in ensurePVC/ensurePod to avoid re-generating random hash
- [x] `opencode-10.3.2` Pass pre-computed hash in api.ts new-project flow
- [x] `opencode-10.3.3` Add regression test: ensurePVC and ensurePod use same hash for new-project sessions
- [x] `opencode-10.3.4` Fix frontend SessionSchema: make repoUrl/branch/sourceBranch optional to match new-project API response
- [x] `opencode-10.3.5` Fix new-project init script: set git identity before commit and guard against re-running on pod restart
- [x] `opencode-10.3.6` Fix resumeSession: pass pre-computed hash in SessionKey so ensurePod does not re-generate random hash for new-project sessions
- [x] `opencode-10.3.7` Fix git identity propagation: write user.name/email into repo local git config in init script
- [x] `opencode-10.3.8` Fix git identity ordering: write local repo config AFTER git init, not before
- [ ] `opencode-10.3.9` Refactor: remove hash from SessionKey; pass as explicit parameter to ensurePVC/ensurePod instead

## Verify
<!-- beads-phase-id: opencode-10.4 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Finalize
<!-- beads-phase-id: opencode-10.5 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

