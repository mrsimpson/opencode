# Development Plan: feat/session-blank-disc

_Generated on 2026-05-11 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Add an option to the opencode-router (Kubernetes backend) and opencode-router-app (frontend UI) to start a session on a "blank disc" — an empty workspace without cloning a GitHub repository. Currently both layers always require `repoUrl`, `branch`, and `sourceBranch`.

## Key Decisions

1. **No explicit "mode" modeling**: The API doesn't use a `mode` field. The backend checks if `repoUrl` is present. If absent → new project (git init). If present → git flow (clone).

2. **Session identity**: When `repoUrl` is absent, use a random hash: `SHA256(email + random UUID)[:12]`. New project sessions are inherently unique.

3. **No special annotations**: No `blank` annotation needed. When `repoUrl` is absent, repo annotations (`ANNOTATION_REPO_URL`, `ANNOTATION_BRANCH`, `ANNOTATION_SOURCE_BRANCH`) simply aren't set. Detection is implicit: check if `ANNOTATION_REPO_URL` is missing.

4. **GITHUB_TOKEN still injected**: Even for new project sessions, the GitHub token secret and envFrom are created. The git credential helper block still runs (it writes `.git-credentials` and sets `user.name`/`user.email`). This ensures `gh repo create`, `git commit`, etc. all work inside the session.

5. **Init container — `git init` instead of `git clone`**: When `repoUrl` is absent, the init script runs `git init /workspace` instead of `git clone`. The GITHUB_TOKEN credential setup block still runs (so git creds are configured). The resulting `/home/opencode/repo/.git` enables opencode's git-based undo features.

6. **Unified progress stage — "preparing"**: Instead of "cloning", the progress stage emitted by both git and new-project flows is "preparing" (`git clone repo` or `git init` both = preparing the repo). This means:
   - Backend `getSessionProgress()` emits `"preparing"` instead of `"cloning"`
   - Frontend `STAGES` array uses `"preparing"` instead of `"cloning"`
   - No separate stage lists needed — one unified list

7. **Frontend UX — Segmented tabs**: Two tabs: `[ Git Repository ] [ New Project ]`.
   - "Git Repository" tab: repo URL + source branch autocompletes + prompt (existing behavior)
   - "New Project" tab: only the prompt textarea
   - No `mode` field in the API — each tab sends different fields

8. **Backward compatibility**: All existing PVCs have `ANNOTATION_REPO_URL` set. They continue to work identically. The "cloning" → "preparing" rename is a UI-only change that affects all sessions.

## Notes

### Architecture Overview

The opencode-router is a Kubernetes-native session router:

- **Router** (`opencode-router/`): Node.js HTTP server running in the cluster. Manages K8s pods and PVCs, proxies traffic to running session pods.
- **Router App** (`opencode-router-app/`): SolidJS SPA served by the router for the setup UI. Lets users create/manage sessions.
- **Router Plugin** (`opencode-router-plugin/`): In-pod plugin that pushes session progress events back to the router API.

### Session Creation Flow (current)

```
User submits form → POST /api/sessions { repoUrl, branch, sourceBranch, initialMessage? }
  → validate repoUrl, branch, sourceBranch required
  → verify sourceBranch exists on remote via Smart HTTP protocol
  → compute session hash = SHA256(email:repoUrl:branch)[:12]
  → ensurePVC() — create PVC with repo annotations
  → ensurePod() — create pod with init container that:
      1. Copies config defaults
      2. Sets up git credentials (if GITHUB_TOKEN present)
      3. git clone <repoUrl> /workspace
      4. git fetch --all
      5. git checkout -B <sourceBranch> origin/<sourceBranch>
      6. git checkout -b <branch>
  → opencode serve starts in /home/opencode/repo (the cloned repo)
→ UI shows loading screen with stages: initializing → configuring → cloning → starting → readying
→ SSE events streamed until pod is ready with deep-link URL
```

### Session Creation Flow (blank disc / "New Project")

```
User selects "New Project" tab, types prompt → POST /api/sessions { initialMessage? }
  → no git validation (repoUrl/branch/sourceBranch all absent)
  → generate random hash = SHA256(email:randomUUID)[:12]
  → ensurePVC() — create PVC without repo annotations
  → ensurePod() — create pod with init container that:
      1. Copies config defaults (same as git mode)
      2. Sets up git credentials (from GITHUB_TOKEN, same as git mode)
      3. git init /workspace (instead of git clone)
      4. Creates initial commit on main branch (so git has a starting point)
  → opencode serve starts in /home/opencode/repo (has .git from git init)
  → opencode discovers the git repo → undo features work
→ UI shows loading screen with stages: initializing → configuring → preparing → starting → readying
  ("preparing" is the unified stage name for both git clone and git init)
→ SSE events streamed until pod is ready with deep-link URL
```

### Key Files

| File                                                     | Role                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/opencode-router/src/pod-manager.ts`            | Core pod/PVC management, init script generation, session hash |
| `packages/opencode-router/src/api.ts`                    | HTTP API for session CRUD                                     |
| `packages/opencode-router/src/api.test.ts`               | API tests                                                     |
| `packages/opencode-router/src/pod-manager.test.ts`       | Pod manager tests                                             |
| `packages/opencode-router/src/config.ts`                 | Environment configuration                                     |
| `packages/opencode-router-app/src/api.ts`                | Frontend API client                                           |
| `packages/opencode-router-app/src/app.tsx`               | Main app component with phase management                      |
| `packages/opencode-router-app/src/session-input-bar.tsx` | New session form                                              |
| `packages/opencode-router-app/src/loading-screen.tsx`    | Session startup loading screen                                |
| `packages/opencode-router-app/src/setup-form-utils.ts`   | Form validation utilities                                     |
| `packages/opencode-router-app/src/i18n/en.ts`            | English i18n strings                                          |

### Interface Changes

**`SessionKey`** (pod-manager.ts):

```typescript
export interface SessionKey {
  email: string
  repoUrl?: string // Made optional — absent/empty = blank disc
  branch?: string // Made optional
  sourceBranch?: string // Made optional
  initialMessage?: string
}
```

**`SessionInfo`** (pod-manager.ts): No structural change. When `repoUrl` / `branch` / `sourceBranch` are absent (blank disc), they'll be returned as empty strings (already the case from `?? ""` fallback in `buildSessionInfo`).

**POST /api/sessions** request body: No structural change. `repoUrl`, `branch`, `sourceBranch` are simply no longer required. When omitted, the session is a blank disc.

### New Constants

None needed. The existing pattern of "annotation absent = not set" is sufficient.

### Stage detection in `getSessionProgress()`

The function needs to know whether to skip "cloning". Instead of a new constant or parameter, it can check whether `repoUrl` is set on the session (derived from pod/PVC annotations), or accept a simpler heuristic: if the pod's init script never runs git commands, the timing heuristic naturally never crosses into "cloning" territory. Either approach works.

### opencode behavior in non-git dir

When opencode starts in a directory without `.git`, it uses `ProjectID.global` and `vcs: undefined`. This is already handled by `Project.fromDirectory()` in `packages/opencode/src/project/project.ts` (lines 179-186). No changes needed in the opencode core.

## Explore

### Tasks

- [x] Identify all files that need changes
- [x] Understand current session creation flow
- [x] Understand how opencode handles non-git directories
- [x] Map out the complete interface and annotation changes
- [x] Document the init script changes for blank mode

### Completed

- [x] Created development plan file
- [x] Explored opencode-router/src/pod-manager.ts — SessionKey, ensurePod init script, getSessionHash, buildSessionInfo, getSessionProgress
- [x] Explored opencode-router/src/api.ts — POST /api/sessions validation and flow
- [x] Explored opencode-router-app/src/app.tsx — App component, phase management
- [x] Explored opencode-router-app/src/session-input-bar.tsx — New session form UI
- [x] Explored opencode-router-app/src/loading-screen.tsx — Startup loading stages
- [x] Explored opencode-router-app/src/setup-form-utils.ts — Form validation logic
- [x] Explored opencode-router-app/src/api.ts — Frontend API client
- [x] Explored opencode-router-app/src/i18n/en.ts — i18n strings
- [x] Explored opencode-router/src/api.test.ts — Test patterns for API
- [x] Explored opencode-router/src/pod-manager.test.ts — Test patterns for pod manager
- [x] Explored opencode/src/project/project.ts — Non-git project handling
- [x] Reviewed test patterns for both backend and frontend tests

## Plan

### Tasks

- [x] Refined Key Decisions based on user feedback (no explicit mode/blank modeling)
- [x] Updated Implementation Strategy for simpler approach (repoUrl optional, no mode field)
- [x] Updated for GITHUB_TOKEN still injected in blank sessions
- [x] Updated for segmented tabs UX (`[ Git Repository ] [ New Project ]`)
- [x] Finalized all 8 files to change across backend and frontend

### Completed

- [x] Read and analyzed all source files in opencode-router (pod-manager.ts, api.ts)
- [x] Read and analyzed all source files in opencode-router-app (api.ts, app.tsx, session-input-bar.tsx, loading-screen.tsx, setup-form-utils.ts, i18n/en.ts, session-utils.ts)
- [x] Read and analyzed all test files (api.test.ts, pod-manager.test.ts, setup-form.test.ts, app.test.ts)
- [x] Identified all interfaces needing changes (SessionKey, SessionInfo, API POST body, PVC/Pod annotations, frontend API client)
- [x] Documented the complete init script changes needed for blank mode
- [x] Documented how hash generation, PVC/Pod creation, progress stages, frontend form, and loading screen all need to change
- [x] Refined plan based on user feedback: simpler approach, no mode field, no blank annotation

### Implementation Strategy

**Core insight**: Make `repoUrl`, `branch`, `sourceBranch` optional in `SessionKey`. When absent → `git init` instead of clone. Unified "preparing" stage covers both paths.

#### Backend Changes — `packages/opencode-router/src/pod-manager.ts`

1. **`SessionKey` interface**: Make `repoUrl`, `branch`, `sourceBranch` optional (`?: string`). No new fields.

2. **`getSessionHash()`**: When `repoUrl` is absent/empty, generate a random hash (`SHA256(email + random UUID)[:12]`). When present, existing deterministic behavior.

3. **`ensurePVC()`**: Conditionally set repo annotations. If `session.repoUrl` is absent, omit `ANNOTATION_REPO_URL`, `ANNOTATION_BRANCH`, `ANNOTATION_SOURCE_BRANCH`. Everything else (user-email, created-at, initial-message) stays the same.

4. **`ensurePod()`**:
   - **Hash**: same `getSessionHash()` logic.
   - **Pod annotations**: When `session.repoUrl` is absent, omit repo annotations — still set last-activity, user-email, pod-secret.
   - **GITHUB_TOKEN**: Always call `ensureGithubTokenSecret()` and add `envFrom` when `githubToken` is provided — even for new project sessions. The credential helper block in the init script still runs (writes `.git-credentials`, sets `user.name`/`user.email`).
   - **Init script — git block changes** (lines 566-578):
     - Replace the unconditional clone block with a conditional:
       ```bash
       if [ -n "${repoUrl}" ]; then
         # git clone + fetch + checkout (existing behavior)
         GIT="git -c safe.directory=/workspace"
         if [ ! -d /workspace/.git ]; then
           git clone "${repoUrl}" /workspace
         fi
         cd /workspace
         $GIT fetch --all
         if $GIT rev-parse --verify "${branch}" >/dev/null 2>&1; then
           $GIT checkout "${branch}"
         else
           $GIT checkout -B "${sourceBranch}" "origin/${sourceBranch}"
           $GIT checkout -b "${branch}"
         fi
       else
         # git init for new project
         git init /workspace
         cd /workspace
         git add -A
         git commit -m "Initial commit" --allow-empty
       fi
       ```
     - The GITHUB_TOKEN credential block (lines 556-565) runs **unconditionally** (before the git block) — so git creds are always configured for both paths.
   - **Main container command**: `git config --global --add safe.directory /home/opencode/repo` still works since `.git` exists from `git init`. No change needed.

5. **`getSessionProgress()`**: Rename the `"cloning"` stage to `"preparing"` (line 297). This unified stage covers both `git clone` and `git init`. No conditional logic needed — same timing heuristic applies.

6. **`buildSessionInfo()`**: No changes needed. When annotations are absent, `ann[ANNOTATION_REPO_URL] ?? ""` returns empty string. Frontend handles this gracefully.

7. **`resumeSession()`**: Read PVC annotations. If `ANNOTATION_REPO_URL` is absent/empty, construct `SessionKey` with just `{ email }`. `ensurePod()` then runs the `git init` path.

#### Backend Changes — `packages/opencode-router/src/api.ts`

8. **POST /api/sessions**: Conditional validation:
   - If `repoUrl` is present → validate branch/sourceBranch required, run `remoteBranchExists()` check (existing behavior)
   - If `repoUrl` is absent → no branch/sourceBranch validation, no `remoteBranchExists()` check
   - Build `SessionKey` with whatever fields are present. No `mode` field.

#### Backend Tests

9. **`pod-manager.test.ts`**: Add tests for:
   - `getSessionHash()` with no repoUrl returns random 12-char hex
   - `ensurePVC()` with no repoUrl creates PVC without repo annotations
   - `ensurePod()` with no repoUrl creates init script with `git init` (not `git clone`)
   - `ensurePod()` with no repoUrl still sets up GITHUB_TOKEN when provided
   - `resumeSession()` works with PVCs that have no repo annotations

10. **`api.test.ts`**: Add tests for:
    - POST /api/sessions without repoUrl succeeds (201)
    - POST /api/sessions without repoUrl does NOT call `remoteBranchExists`
    - POST /api/sessions with repoUrl still requires sourceBranch (existing behavior)

#### Frontend Changes — `packages/opencode-router-app`

11. **`i18n/en.ts`**: Add/modify strings:
    - `"form.tab.git"`: "Git Repository"
    - `"form.tab.newProject"`: "New Project"
    - Change `"loading.stage.cloning"` → rename key to `"loading.stage.preparing"` with value "Preparing repository"

12. **`setup-form-utils.ts`**:
    - Keep `buildSessionKey()` unchanged (still validates repoUrl + sourceBranch — used by git tab).
    - Add `buildNewProjectKey(promptText: string)` — validates prompt non-empty, returns `{ valid: true }`.
    - Export both.

13. **`session-input-bar.tsx`**:
    - Add `activeTab` signal (`"git" | "new-project"`), default `"git"`.
    - Segmented tab bar at top: `[ Git Repository ] [ New Project ]`.
    - Git tab: existing form (repo autocomplete + branch autocomplete + prompt + submit).
    - New project tab: only prompt textarea + submit button.
    - Emit different session key types per tab.
    - `disabledReason()` / `canSubmit()` wide enough for both modes.

14. **`loading-screen.tsx`**:
    - Rename `"cloning"` → `"preparing"` in `STAGES` array.
    - Update `STAGE_LABEL_KEY` to use new i18n key.
    - No `hasRepo` prop needed — single unified stage list.

15. **`app.tsx`**:
    - Track `activeTab` signal, pass to `SessionInputBar`.
    - `handleSubmit()`: git tab → existing flow. New project tab → `createSession({ initialMessage })`.
    - Reset `activeTab` on home navigation.

16. **`setup-form.test.ts`**: Add tests for `buildNewProjectKey()`.

#### Dependencies

```
pod-manager.ts (SessionKey, getSessionHash, ensurePVC, ensurePod, getSessionProgress, resumeSession)
  └─→ api.ts (conditional validation)
       └─→ pod-manager.test.ts + api.test.ts
            └─→ api.ts (frontend) + i18n/en.ts
                 └─→ setup-form-utils.ts
                      └─→ session-input-bar.tsx + loading-screen.tsx + app.tsx
                           └─→ setup-form.test.ts
```

#### Edge Cases

1. **Resume of blank sessions**: PVCs without repo annotations → `resumeSession()` builds `SessionKey` with `{ email }` → `ensurePod()` runs `git init` path. Hash recovered from PVC labels.

2. **prepullImage**: Uses hardcoded repoUrl — unchanged.

3. **Backward compatibility**: "cloning" → "preparing" is a non-breaking rename (both backend SSE and frontend stage list change together). Existing PVCs all have `ANNOTATION_REPO_URL` and work identically.

4. **`git init` with GITHUB_TOKEN**: The credential block runs before the git block, so git creds are always configured. `git config --global credential.helper store` and `git config --global user.name/email` are set even in new project sessions — this is desirable (user can `git commit` with proper author info).

5. **Initial commit after `git init`**: Without an initial commit, `git status` shows an empty working tree but `git log` fails. Adding `--allow-empty` initial commit gives a clean starting point.

6. **Frontend session list empty repoUrl**: Sessions without repoUrl show `""`. Could be handled as "New project" display in session list — polish task.

## Code

### Tasks

1. [x] **pod-manager.ts — Make SessionKey fields optional + getSessionHash random branch**
   - `repoUrl`, `branch`, `sourceBranch` become `?: string`
   - `getSessionHash()`: when repoUrl absent/empty, use `SHA256(email + random UUID)[:12]`

2. [x] **pod-manager.ts — ensurePVC conditional annotations**
   - Omit repo annotations when `session.repoUrl` is absent

3. [x] **pod-manager.ts — ensurePod conditional init script**
   - Hash + pod annotations conditional on repoUrl presence
   - Init script: if repoUrl → clone block; else → `git init` + initial commit block
   - GITHUB_TOKEN block runs unconditionally
   - Pod envFrom for github token still set

4. [x] **pod-manager.ts — getSessionProgress rename "cloning" → "preparing"**
   - One-line change in the timing heuristic fallback

5. [x] **pod-manager.ts — resumeSession blank-aware**
   - Reconstruct SessionKey without repo fields when PVC lacks repo annotations

6. [x] **api.ts — POST /api/sessions conditional validation**
   - Only validate branch/sourceBranch/remoteBranchExists when repoUrl is present

7. [x] **pod-manager.test.ts — tests for blank/new-project flows**
   - Random hash, PVC without repo anns, init script with `git init`, GITHUB_TOKEN still injected, resume

8. [x] **api.test.ts — tests for new project API endpoint**
   - POST without repoUrl succeeds, doesn't call remoteBranchExists, still requires repoUrl for git mode

9. [x] **i18n/en.ts — new strings + rename cloning → preparing**
   - `form.tab.git`, `form.tab.newProject`
   - Rename `loading.stage.cloning` → `loading.stage.preparing`

10. [x] **setup-form-utils.ts — add buildNewProjectKey**
    - New function for new project tab validation

11. [x] **session-input-bar.tsx — segmented tabs**
    - `[ Git Repository ] [ New Project ]` tabs
    - Git tab: existing form. New project tab: prompt only.
    - Emit different session keys per tab

12. [x] **loading-screen.tsx — rename cloning → preparing**
    - Update STAGES array and STAGE_LABEL_KEY

13. [x] **app.tsx — active tab state**
    - Track activeTab, pass to SessionInputBar, handleSubmit per tab

14. [x] **setup-form.test.ts — buildNewProjectKey tests**

### Completed

- [x] **Task 1**: Made SessionKey fields optional (repoUrl?, branch?, sourceBranch?), getSessionHash generates random hash when repoUrl absent
- [x] **Task 2**: ensurePVC conditionally omits repo annotations when repoUrl absent
- [x] **Task 3**: ensurePod conditionally generates git init vs git clone init script; GITHUB_TOKEN block always runs
- [x] **Task 4**: getSessionProgress renamed "cloning" → "preparing" (stage + doc comment)
- [x] **Task 5**: resumeSession builds SessionKey without repo fields when PVC lacks ANNOTATION_REPO_URL
- [x] **Task 6**: api.ts POST /api/sessions uses early-return for git flow vs new project flow
- [x] **Task 7**: Added 8 pod-manager tests: random hash, PVC without repo anns, init script with `git init`, GITHUB_TOKEN still injected, resume blank
- [x] **Task 8**: Added 5 API tests: new project succeeds, doesn't call remoteBranchExists, passes githubToken, backward compat
- [x] **Task 9**: Added `form.tab.git`, `form.tab.newProject` i18n keys; renamed `loading.stage.cloning` → `loading.stage.preparing`
- [x] **Task 10**: Added `buildNewProjectKey()` function for new project tab validation
- [x] **Task 11**: SessionInputBar now has segmented `[Git Repository]` / `[New Project]` tabs; git tab shows repo+branch fields, new project tab shows prompt only
- [x] **Task 12**: LoadingScreen STAGES array uses "preparing" instead of "cloning"
- [x] **Task 13**: app.tsx tracks activeTab signal, passes to SessionInputBar, handleSubmit branches per tab
- [x] **Task 14**: Added 4 buildNewProjectKey tests: valid prompt, trim, empty, whitespace

## Commit

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_None yet_

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
