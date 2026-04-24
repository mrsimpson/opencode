# Development Plan: opencode (claude-code-like branch)

_Generated on 2026-04-24 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Redesign the `opencode-router-app` UI to match the two-panel layout and UX of Claude Code web (`claude.ai/code`), while keeping all existing API interactions and business logic intact.

**In scope:**

- Two-panel layout: collapsible sidebar (left) + main content area (right)
- Sidebar: Logo, "New Session" button, collapsible "Recents" section listing sessions with state badges
- Main area: Welcome heading with user email, "Sessions" card (active sessions), bottom prompt-style new-session form (repo URL input + source branch + send button)
- State badges: green "Ready" (running), grey "Inactive" (stopped), spinner (creating)
- Session items: repo name, branch name, relative age, click to open (running) or resume (stopped)
- Terminate action moved to a 3-dot options menu on each sidebar session item
- PR section omitted (no API data available)
- Sidebar collapsible (toggle button)

**Out of scope:**

- Pull Request section (no PR data in API)
- Desktop app download banner
- "Routines", "Customize", "More" action buttons (not applicable)
- Pinned sessions section

## Key Decisions

- **Layout framework**: SolidJS + TailwindCSS — keep as-is, no new dependencies
- **Sidebar state**: `createSignal<boolean>` for collapsed/expanded, no persistence needed
- **Session title**: Use `session.branch` as the human-readable title (existing convention)
- **Repo display**: Strip `https://` and `.git` suffix (existing convention)
- **New session form placement**: Inline in main content area (bottom), not a separate route/phase — show/hide with a signal
- **No new API changes**: All existing API functions (`listSessions`, `createSession`, etc.) remain unchanged
- **Collapsible component**: Use `@opencode-ai/ui/collapsible` for sidebar sections
- **Tag component**: Use `@opencode-ai/ui/tag` for state badges with CSS custom properties for color
- **DropdownMenu**: Use `@opencode-ai/ui/dropdown-menu` for per-session 3-dot menu (terminate, resume)
- **i18n**: Add new keys for sidebar/main area labels; keep all existing keys

### Phase machine → two-panel mapping

The current `loading → list → new-session → creating → error` phase machine maps to the two-panel layout as follows:

| Old phase     | New location                                                                   | Notes                              |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| `loading`     | Spinner centered in `<main>`                                                   | Sidebar hidden during initial load |
| `list`        | Main sessions card + sidebar recents                                           | Both always visible once loaded    |
| `new-session` | **Eliminated as a phase** — becomes persistent input bar at bottom of `<main>` | Form signals lifted into `app.tsx` |
| `creating`    | `<LoadingScreen>` replaces main content only                                   | Sidebar stays visible              |
| `error`       | Inline banner in `<main>`                                                      | Not a full-page takeover           |

### File structure (final)

```
src/
  app.tsx                    # Rewritten: layout shell + all signals
  setup-form.tsx             # Kept for reference; logic inlined into app.tsx input bar
  session-input-bar.tsx      # New: extracted input bar component (receives signals as props)
  loading-screen.tsx         # Unchanged
  session-utils.ts           # Unchanged
  setup-form-utils.ts        # Unchanged
  api.ts                     # Unchanged
  i18n/en.ts                 # Extended
  i18n/de.ts                 # Extended
```

### Signal architecture (in app.tsx)

```ts
// Layout
const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

// App phase (simplified — no more "list" or "new-session" as phases)
// { kind: "loading" } | { kind: "ready" } | { kind: "creating"; hash; url } | { kind: "error"; message }
const [appPhase, setAppPhase] = createSignal<AppPhase>({ kind: "loading" })

// Data (fetched once, polled every 5s)
const [sessions, setSessions] = createSignal<Session[]>([])
const [email, setEmail] = createSignal("")

// Terminate in-progress set
const [terminating, setTerminating] = createSignal<Set<string>>(new Set())

// New session form (always mounted, at bottom of main)
const [repoUrl, setRepoUrl] = createSignal("")
const [sourceBranch, setSourceBranch] = createSignal("")
const [sessionBranch, setSessionBranch] = createSignal("")
const [formError, setFormError] = createSignal("")
const [submitting, setSubmitting] = createSignal(false)
```

### Status dot implementation

```tsx
const StatusDot = (props: { state: Session["state"] }) => {
  if (props.state === "creating") return <Spinner size="sm" />
  return (
    <span
      class="size-2 rounded-full shrink-0"
      style={{ background: props.state === "running" ? "var(--surface-success-strong)" : "var(--icon-base)" }}
    />
  )
}
```

### Send button enabled condition

Enabled only when: `repoUrl()` passes `GIT_URL_PATTERN` AND `sourceBranch()` is non-empty AND `sessionBranch()` is non-empty AND `promptText()` is non-empty (≥1 char) AND `!submitting()`.

### Initial message + session title (NEW decision — 2026-04-24)

**Context:** In the Claude Code UX, you always type a prompt before creating a session. The session title is auto-derived from that first message by opencode itself (it replaces the default ISO-timestamp title after the LLM processes the first turn). The router-app is responsible only for collecting the message and passing it along.

**How it flows:**

```
User types prompt in input bar
  → createSession(repoUrl, sessionBranch, sourceBranch, initialMessage) [frontend]
  → POST /api/sessions { repoUrl, branch, sourceBranch, initialMessage } [router API]
  → ensurePod(session) starts the pod
  → session.url is returned
  → LoadingScreen polls until running
  → window.location.replace(session.url + "?initialMessage=<encoded>")  ← append message to redirect URL
      OR
  → opencode pod picks it up via env var OPENCODE_INITIAL_MESSAGE
```

**Decision: pass via URL query param on redirect**

Rationale:

- No opencode server changes needed at create time
- The opencode web UI (running inside the pod) can read `?initialMessage=…` from `window.location.search` on mount and auto-populate + auto-send the first message
- This requires a small addition to the opencode web UI — acceptable, small change
- Alternative (env var in ConfigMap) would require router-side changes and a pod restart cycle

**What this means for router-app changes:**

1. `createSession()` in `api.ts` accepts optional `initialMessage?: string` — passes it in the POST body
2. Router backend (`opencode-router/src/api.ts`) reads `initialMessage` from the body — appends it to the `url` returned in the 201 response: `url + "?initialMessage=" + encodeURIComponent(initialMessage)`
3. `LoadingScreen` already redirects to `session.url` — no change needed there
4. The opencode web UI (separate change) reads `?initialMessage` on mount and auto-sends
5. Session title in sidebar: once opencode processes the first message it updates the title — but opencode exposes title via the session list API (`listSessions`) only after it's been set. For now, display `session.branch` as before (which is already the convention); the actual title update is a future improvement once the session list API exposes it.

**What changes in the router-app:**

- `api.ts`: `createSession(repoUrl, branch, sourceBranch, initialMessage?: string)` — adds optional 4th param
- `app.tsx` input bar: prompt textarea is **required** (not cosmetic); Send enabled only when prompt is non-empty
- `app.tsx` submit handler: passes `promptText()` to `createSession()`
- `opencode-router/src/api.ts`: appends `?initialMessage=…` to the `url` in the 201 response

## Notes

### Current app structure

- `app.tsx`: Phase-based state machine (`loading` → `list` → `new-session` → `creating` → `error`), single centered card
- `setup-form.tsx`: Standalone form component for new session creation
- `api.ts`: REST API client — `listSessions`, `createSession`, `getSessionState`, `terminateSession`, `resumeSession`, `suggestBranch`
- `loading-screen.tsx`: Polls `getSessionState` until running, then `window.location.replace(url)`
- `session-utils.ts`: `computeIdleStatus` helper for idle/stop label
- `i18n/en.ts` + `de.ts`: Translation dictionary

### Claude Code web UX (inspected via Playwright/CDP)

**Sidebar structure:**

- `<aside>` with resize handle separator
- Header row (`h-11`): Logo link → "Claude Code" svg, "Collapse sidebar" button, "Search" button
- Action row: `New session ⇧⌘O` button, `Routines`, `Customize`, `More` buttons
- **Pinned** collapsible section (expandable, empty "Drag to pin" placeholder)
- **Recents** collapsible section with "View all" link on hover
  - Each session row: `data-row-key="chat:{uuid}"` div wrapping:
    - Main button with session title text (truncated with mask-image gradient)
    - Hidden-on-hover overlay with a **"Weitere Optionen" (3-dot menu) button** (`aria-label="Weitere Optionen für {title}"`)
- Bottom area: "Probiere Claude Code auf dem Desktop" banner (dismissable) + user profile button ("Oliver J") + theme/beta buttons

**Main content area:**

- Welcome heading: `<h1>Willkommen zurück, Oliver</h1>` with logo image
- **Sessions card** (`<h2>Sitzungen</h2>`): list of session buttons with:
  - Unread badge label (`generic: Ungelesen`)
  - Session title text
  - Repo name (`mrsimpson/lobehub`)
  - Relative age (`3d`)
  - Arrow icon
- **Pull Requests card** (`<h2>Pull Requests</h2>`): list with:
  - Status badge (`In Prüfung` = In Review)
  - PR title
  - PR number (`#254`)
  - Diff stats (`+90 −24`) with size label (`S`)
  - Repo name + relative age + arrow

**New session input bar** (bottom of main, always visible):

- Left: expand/collapse button
- Repo selector row:
  - "Default" profile button (with icon)
  - "Repo auswählen …" button → opens `<listbox>` of repos (fetched from GitHub, `owner/name` format)
  - After repo selected: shows `[repo-name]` button + `[branch-name]` button + hidden textbox with full repo JSON + branch name textbox
  - Branch button → opens `<listbox>` with branches + search combobox (`"Branches durchsuchen…"`)
  - "Clear repo" button (active state after selection)
  - Additional free-text search textbox (e597) — likely for filtering/free-form entry
- Prompt textarea (`contenteditable`, label="Prompt", placeholder="Beschreibe eine Aufgabe oder stelle eine Frage")
- Send button (disabled until text entered, enabled with repo+prompt)
- Bottom toolbar:
  - "Planmodus" button
  - "Transkript-Ansichtsmodus" button
  - "Hinzufügen" button
  - Dictate button group
  - Model selector: "Sonnet 4.6"
  - Usage indicator: "Usage: plan 0%"

**Key new session flow:**

1. User clicks "New session" button in sidebar (OR focus the prompt bar directly)
2. Prompt bar is already visible; "New session" just marks button [active]
3. User clicks "Repo auswählen…" → listbox of GitHub repos appears
4. User picks a repo → repo button + branch button appear; default branch pre-selected
5. User clicks branch button → listbox with branches + search appears; can select any branch
6. User types prompt text → Send button becomes enabled
7. User clicks Send → session creation starts (navigates to session URL)

**Adaptation decisions (our app vs. Claude Code):**

- Claude Code: repo = GitHub repo list from API; **Our app**: repo = manual URL input + source branch text field
- Claude Code: branch = picker from repo's branches; **Our app**: branch = free-text `sourceBranch` field + auto-suggested `sessionBranch`
- Our new session bar should: repo URL text input (replacing repo picker) + source branch text input (replacing branch picker) + prompt area → on submit calls `createSession()`
- The "Default" profile button in Claude Code has no equivalent in our app — omit
- The prompt textarea is **required** (Send disabled if empty) — it is passed as `initialMessage` to `createSession()` and forwarded as `?initialMessage=<encoded>` in the session redirect URL so the opencode web UI can auto-send it
- The prompt textarea being required is the main UX change from the current flow (previously optional / UX only)

### LoadingScreen — initialMessage threading

`LoadingScreen` currently redirects to `props.url`. The `?initialMessage=…` is baked into `url` by the router's 201 response, so it flows through `createSession()` → `app.tsx` → `LoadingScreen` without any polling changes. Minimal `LoadingScreen` change: add optional `initialMessage?: string` prop as a fallback for resumed sessions (which don't have an initial message URL):

```ts
window.location.replace(
  props.initialMessage
    ? `${props.url}${props.url.includes("?") ? "&" : "?"}initialMessage=${encodeURIComponent(props.initialMessage)}`
    : props.url,
)
```

### E2E test rewrite scope

The existing `e2e/session-lifecycle.spec.ts` must be rewritten because all selectors change:

| Old selector / flow                       | New selector / flow                                   |
| ----------------------------------------- | ----------------------------------------------------- |
| `"Signed in as"` text                     | `"Welcome back,"` heading                             |
| Click `"New Session"` → form opens        | Input bar always visible at bottom                    |
| `"← Back"` button                         | Gone (no back navigation)                             |
| `"Your sessions"` text                    | Sessions card `<h2>`                                  |
| Textbox only visible after button click   | Textbox always visible                                |
| `"Start Session"` button                  | Send button (enabled when all fields + prompt filled) |
| Direct `"Terminate"` button on card       | 3-dot menu → "Terminate" item                         |
| Direct `"Resume"` button                  | 3-dot menu → "Resume" OR click stopped session item   |
| New session: repo + branch → click submit | repo + branch + **prompt text** → click send          |

### initialMessage delivery — alternatives analysis (constraint: no core package changes)

**Constraint:** `packages/opencode` and `packages/web` (the opencode SPA served from each pod) must not be changed.

**What opencode's HTTP API exposes (usable without changes):**

- `POST /session` — create an opencode internal session
- `POST /session/:id/prompt_async` — send a message asynchronously (fire-and-forget)
- `POST /session/:id/message` — send + stream response

#### Option A — UX affordance only

Prompt textarea is purely contextual. Session created without message. User types in opencode. opencode derives title from the first message typed there.

- ✅ Zero additional complexity; redesign is fully independent
- ❌ User types message twice — once in router-app (lost), once in opencode

#### Option B — Store as pod annotation, surface in sidebar

`initialMessage` saved as Kubernetes pod label at create time. `listSessions` returns it as `description` on each session. Sidebar shows it as session subtitle. User still re-types in opencode.

- ✅ Meaningful sidebar labels without opencode changes
- ❌ Message still not sent to opencode; user re-types

#### Option C — Router bootstraps opencode session after pod starts

New router endpoint `POST /api/sessions/:hash/init`: after pod reaches `running`, calls pod's internal opencode HTTP API to create a session and fire `prompt_async`. LoadingScreen calls this before redirecting.

- ✅ Message actually sent; title auto-derived by opencode; user arrives to active chat
- ❌ Router needs internal pod networking; adds latency; most complex

#### Option D — URL fragment + clipboard assist

Pass `#message=<encoded>` in redirect URL (ignored by opencode). LoadingScreen shows a "Copy task" button.

- ✅ No backend changes at all
- ❌ Still fully manual; cosmetic only

#### **Decision: bootstrap ConfigMap + `opencode run` + PVC annotation**

This is the fully automated approach, entirely within `packages/opencode-router`. No core packages touched.

**How it works — end to end:**

```
POST /api/sessions { repoUrl, branch, sourceBranch, initialMessage }
  ↓
ensurePVC(session)
  → adds ANNOTATION_INITIAL_MESSAGE to PVC annotations (durable across pod restarts)

ensureBootstrapConfigMap(hash, initialMessage)   [NEW]
  → creates ConfigMap "opencode-bootstrap-{hash}"
  → data: { "initial-message.txt": initialMessage }

ensurePod(session)
  → mounts "opencode-bootstrap-{hash}" at /home/opencode/.opencode-bootstrap/ (readOnly)
  → startup script updated:

    git config ... ; set -a; . .env 2>/dev/null || true; set +a
    if [ -f /home/opencode/.opencode-bootstrap/initial-message.txt ] \
       && [ ! -f /home/opencode/.initial-message-sent ]; then
      opencode run "$(cat /home/opencode/.opencode-bootstrap/initial-message.txt)"
      touch /home/opencode/.initial-message-sent          # on the PVC — survives restarts
    fi
    exec opencode serve --hostname 0.0.0.0 --port {port}

  → the "opencode run" invocation:
      - bootstraps its own in-process server (standalone mode — no --attach flag)
      - creates an opencode session
      - sends the message → opencode processes it → derives a title from the message
      - exits cleanly
  → "opencode serve" starts AFTER run exits → picks up the existing session

terminateSession(hash)
  → also deletes ConfigMap "opencode-bootstrap-{hash}"  [NEW]
```

```sh
# Start serve immediately in background
opencode serve --hostname 0.0.0.0 --port 4096 &
SERVE_PID=$!

# Fire initial message once serve is actually healthy (avoids race with LLM blocking serve startup)
if [ -f /home/opencode/.opencode-bootstrap/initial-message.txt ] \
   && [ ! -f /home/opencode/.initial-message-sent ]; then
  until wget -q -O- http://localhost:4096/health >/dev/null 2>&1; do sleep 1; done
  opencode run --attach http://localhost:4096 \
    "$(cat /home/opencode/.opencode-bootstrap/initial-message.txt)" &
  touch /home/opencode/.initial-message-sent   # on PVC — survives restarts
fi

wait $SERVE_PID
```

**Why `--attach` not standalone:**

If `opencode run` ran standalone (in-process, no `--attach`) BEFORE `opencode serve`, the LLM processing (30s–2min) would block the entire startup. The pod's `/health` endpoint would not respond until `opencode serve` starts. `LoadingScreen` would timeout or the user would get a 502. Running `opencode run --attach` AFTER serve is up solves this — LLM runs in background via the live server, serve is immediately available.

**k8s readiness probe (task 6.2.19):**

Add to pod spec:

```ts
readinessProbe: {
  httpGet: { path: "/health", port: config.opencodePort },
  initialDelaySeconds: 5,
  periodSeconds: 3,
  failureThreshold: 20,  // ~60s tolerance for serve startup
}
```

Update `getPodState` to check `pod.status.conditions?.find(c => c.type === "Ready" && c.status === "True")` instead of just `phase === "Running"`. This ensures `LoadingScreen` waits until `opencode serve` is actually serving HTTP, not just until the container process started.

**What the user sees — updated with deep link redirect:**

| Phase                                        | Duration | UI                                                         |
| -------------------------------------------- | -------- | ---------------------------------------------------------- |
| Pod scheduling + init container (git clone)  | 10–60s   | `LoadingScreen`                                            |
| `opencode serve` starting                    | 2–5s     | `LoadingScreen` (readiness probe pending)                  |
| `opencode run --attach` creates session      | ~1s      | `LoadingScreen` (no session in API yet → stays "creating") |
| Session visible in pod's `GET /session`      | —        | `LoadingScreen` detects session → redirects to deep link   |
| LLM processing initial message in background | 30s–2min | **Opencode web UI, session streaming live**                |

### Deep link URL construction (task 6.2.20)

URL pattern (from live sample: `https://54befadac763-oc.no-panic.org/L2hvbWUvb3BlbmNvZGUvcmVwbw/session/ses_2470dd859ffeJ65FNqzi8djrL7`):

```
{pod_url}/{base64(workspacePath)}/session/{sessionID}
```

- `workspacePath` = `/home/opencode/repo` — hardcoded constant in `ensurePod`
- `base64("/home/opencode/repo")` = `L2hvbWUvb3BlbmNvZGUvcmVwbw` — always the same, no padding
- `sessionID` = `data[0].id` from `GET http://{podIP}:{port}/session?limit=1&roots=true`

The router already fetches from the pod's internal API in `podActivityMs`:

```ts
// existing pattern — extend to also return session id
const res = await fetch(`http://${ip}:${config.opencodePort}/session?limit=1&roots=true`)
const data = (await res.json()) as { id: string; time: { updated: number } }[]
const sessionId = data[0]?.id
```

**`getSessionState` updated logic (used by LoadingScreen):**

1. Check k8s pod readiness (`Ready=true` condition) — if not ready → `"creating"`
2. If ready, fetch `GET /session?limit=1&roots=true` on pod → if no session yet → `"creating"`
3. If session found → `{ state: "running", url: deepLink(podUrl, sessionId) }`

`LoadingScreen` polls until `state === "running"` — then it has the exact deep link and redirects immediately to the live session.

### Session interaction design — all states (covers sidebar + main sessions card)

`listUserSessions` iterates **PVCs** (not pods), so all sessions appear regardless of whether the pod is running. This is the correct data source for both the sidebar and the main sessions card.

#### State → UI mapping

| `session.state` | Sidebar dot  | Click row                  | 3-dot menu        | Main card click                  |
| --------------- | ------------ | -------------------------- | ----------------- | -------------------------------- |
| `running`       | 🟢 green dot | Open deep link in same tab | Terminate         | Open deep link                   |
| `stopped`       | ⚫ grey dot  | Resume → `LoadingScreen`   | Resume, Terminate | Resume → `LoadingScreen`         |
| `creating`      | `<Spinner>`  | Disabled (nothing)         | Terminate         | — (no card, or show as creating) |

#### Stopped session URL

No deep link needed upfront. On Resume:

1. `resumeSession(hash)` API call
2. `setAppPhase({ kind: "creating", hash, url: session.url })`
3. `LoadingScreen` polls `getSessionState` until ready
4. `getSessionState` resolves to deep link once session is visible in pod API
5. Redirect to `{pod_url}/{base64dir}/session/{sessionID}`

#### Running session URL

`listUserSessions` now queries pod's `/session?limit=1&roots=true` for running pods → returns `url` as deep link. Clicking the session row navigates directly to the live session in opencode.

#### Session display fields (both sidebar and main card)

| Field                  | Source                                                          |
| ---------------------- | --------------------------------------------------------------- |
| Title                  | `session.branch` (auto-generated session name)                  |
| Description / subtitle | `session.description` (= `ANNOTATION_INITIAL_MESSAGE` from PVC) |
| Repo                   | `session.repoUrl` stripped of `https://` and `.git`             |
| Age                    | derived from `session.lastActivity` (relative: "3d", "2h")      |
| State badge            | `session.state` → dot color or spinner                          |

#### Actions available per state

- **Running**: "Open" (primary click) + "Terminate" (3-dot)
- **Stopped**: "Resume" (primary click) + "Resume" + "Terminate" (3-dot)
- **Creating**: no primary action + "Terminate" (3-dot, edge case)

The terminate action always shows a confirmation `<Dialog>` before calling `terminateSession()`.

This design is **fully covered by existing tasks 6.2.3 (sidebar) and 6.2.4 (main card)** — no new tasks needed.

**Resume behaviour:**

When a pod is stopped and resumed (`resumeSession`), the startup script runs again. But `/home/opencode/.initial-message-sent` is on the PVC and still exists → `opencode run` is skipped. The user arrives at the same session with its history intact.

**Sentinel file location:** `/home/opencode/.initial-message-sent` — on the PVC root (not in `.opencode/` which is the readOnly ConfigMap mount). Survives pod deletion + recreation as long as the PVC exists.

**`listSessions` returns `description`:** reads `ANNOTATION_INITIAL_MESSAGE` from the PVC annotation → returned as optional `description?: string` on each `SessionInfo`. Sidebar shows it as subtitle.

**Tasks:**

- `6.2.15`: `ensureBootstrapConfigMap(hash, initialMessage)` — create per-session ConfigMap
- `6.2.16`: `ensurePVC` — add `ANNOTATION_INITIAL_MESSAGE` to PVC annotations; `listSessions` returns it as `description`
- `6.2.17`: `ensurePod` — mount bootstrap ConfigMap + update startup command with sentinel logic
- `6.2.18`: `terminateSession` — delete bootstrap ConfigMap on teardown
- `6.2.9`: `api.ts` (router-app) — `createSession()` passes `initialMessage`; `Session` interface gets `description?: string`

### Decisions NOT requiring new tasks

- **`setup-form.test.ts`**: tests only `buildSessionKey` from `setup-form-utils.ts` (unchanged). No update needed.
- **`app.test.ts`**: tests only `computeIdleStatus` (unchanged). No update needed.
- **`Session` interface**: add optional `description?: string`. No other title field needed.
- **`GIT_URL_PATTERN`**: re-declare inline in `app.tsx`; do not move to `setup-form-utils.ts` (that file stays unchanged).
- **`setup-form.tsx`**: deleted in task `6.2.13` after its logic is inlined into `app.tsx`.

## Explore

<!-- beads-phase-id: opencode-6.1 -->

### Tasks

<!-- beads-synced: 2026-04-24 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Plan

<!-- beads-phase-id: opencode-6.2 -->

### Tasks

<!-- beads-synced: 2026-04-24 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Code

<!-- beads-phase-id: opencode-6.3 -->

### Tasks

<!-- beads-synced: 2026-04-24 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Commit

<!-- beads-phase-id: opencode-6.4 -->

### Tasks

<!-- beads-synced: 2026-04-24 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
