# Claude Code Web UX — Reference Document

> **Purpose:** This document captures the complete UX structure, component hierarchy, interaction flows, and adaptation decisions for rebuilding `opencode-router-app` to match `claude.ai/code`. It is intended for use by a coding agent during the Plan/Code phases.
>
> **Captured via:** Playwright/CDP attached to live authenticated Edge session on 2026-04-24.
>
> **Raw DOM snapshots:**
>
> - Full page (home state): `.playwright-cli/claude-code-full.yml`
> - After "New session" click: `.playwright-cli/new-session-flow.yml`
> - Full page with expanded sidebar recents (deepest capture): `.playwright-cli/page-2026-04-24T06-30-27-150Z.yml`

---

## 1. Overall Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  <aside> (sidebar, ~240px, resizable, collapsible)              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ HEADER ROW (h-11)                                        │   │
│  │  [Claude Code logo]  [Collapse ⌘B]  [Search]            │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ACTION ROW                                               │   │
│  │  [New session ⇧⌘O]  [Routines]  [Customize]  [More]     │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ PINNED section (collapsible, expanded by default)        │   │
│  │   → "Drag to pin" placeholder when empty                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ RECENTS section (collapsible, expanded by default)       │   │
│  │   [Recents ▶]  [Filter (active)]  [View all]            │   │
│  │   ● Session item row (×N)                                │   │
│  │     [status-icon] [title text]  [⋯ options]             │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ FOOTER                                                   │   │
│  │  [Desktop app promo banner — dismissable]                │   │
│  │  [Oliver J avatar]  [Theme]  [Beta exit]                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  <main> (flex-1, scroll)                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ WELCOME HEADER                                           │   │
│  │   [logo img]  <h1>Willkommen zurück, Oliver</h1>        │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ SESSIONS CARD                                            │   │
│  │   <h2>Sitzungen</h2>                                     │   │
│  │   ● Session list item (×N)                               │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ PULL REQUESTS CARD  (out of scope for our app)           │   │
│  │   <h2>Pull Requests</h2>                                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ NEW SESSION INPUT BAR (always visible, pinned to bottom) │   │
│  │   [expand] [Default] [repo selector] [branch selector]   │   │
│  │   [prompt textarea ………………………] [Send]                    │   │
│  │   [Plan mode] [Transcript] [Add] [Mic] | [Model] [Usage] │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**DOM snapshot reference (top-level structure):**
→ `.playwright-cli/claude-code-full.yml` lines 1–74

```yaml
# Top-level structure (abridged)
- generic [ref=e1]:
    - generic [ref=e2]:
        - generic [ref=e6]:
            - complementary [ref=e7]: # <aside> (sidebar)
                # ... sidebar content
            - main [ref=e521]: # <main>
                # ... main content
```

---

## 2. Sidebar — Detailed Component Breakdown

### 2.1 Header Row

**DOM ref:** `e12` in `claude-code-full.yml`

```yaml
- generic [ref=e12]:
    - generic [ref=e13]:
        - link "Claude Code" [ref=e14]: # Logo link → /code
            - img "Claude Code" [ref=e15]
        - generic [ref=e26]: Recherche-Vorschau # "Research preview" badge
    - button "Collapse sidebar" [ref=e29] # ⌘B toggle
    - button "Search" [ref=e33] # Search icon button
```

**Our implementation:**

- Logo: `<Logo />` from `@opencode-ai/ui/logo` (already used)
- Collapse button: `IconButton` wrapping chevron/sidebar icon; toggles `createSignal<boolean>(false)` for `sidebarCollapsed`
- Search button: omit (no search feature in our app)

---

### 2.2 Action Row

**DOM ref:** `e37` in `claude-code-full.yml`

```yaml
- generic [ref=e37]:
    - button "New session ⇧⌘O" [ref=e38]:
        - generic [ref=e40]: # icon slot
        - text: New session
        - generic [ref=e41]: ⇧⌘O # keyboard shortcut badge
    - button "Routines" [ref=e42] # OUT OF SCOPE
    - button "Customize" [ref=e46] # OUT OF SCOPE
    - button "More" [ref=e50] # OUT OF SCOPE
```

**Our implementation:**

- Keep only `New session` button using `<Button variant="primary" size="small">New Session</Button>`
- Clicking it scrolls/focuses the prompt bar at the bottom of main content (does NOT navigate away)
- In original Claude Code: clicking marks button `[active]` state but page stays the same

---

### 2.3 Pinned Section

**DOM ref:** `e58`/`e64` in `page-2026-04-24T06-30-27-150Z.yml`

```yaml
- generic [ref=e58]:
    - button "Pinned" [expanded] [ref=e61]:
        - generic [ref=e62]: Pinned
        - generic [ref=e63]: # chevron arrow icon
    - generic [ref=e64]:
        - img [ref=e67]
        - generic [ref=e69]: Drag to pin # empty state placeholder
```

**Our implementation:** Omit entirely (out of scope).

---

### 2.4 Recents Section

**DOM ref:** `e71`–`e493` in `page-2026-04-24T06-30-27-150Z.yml`

```yaml
- generic [ref=e71]:
    - generic [ref=e73]: # section header row
        - button "Recents" [expanded] [ref=e74]:
            - generic [ref=e75]: Recents
            - generic [ref=e76]: # chevron icon
        - button "Filter (active)" [ref=e77] # filter toggle
    - generic [ref=e79]: # session list container
        - generic [ref=e82]: # session item wrapper
            - button "Archiviert Fetch and reset..." [ref=e83]:
                - img "Archiviert" [ref=e85]: # STATUS ICON (archived/stopped)
                    - generic [ref=e86]: # icon element
                - generic [ref=e88]: Fetch and reset to upstream dev branch # title
            - generic: # hover overlay
                - button "Weitere Optionen für {title}": # 3-dot options button
                    - generic:
                        - img # ellipsis icon
```

**Session item pattern (per item):**

```
[status-icon] [session title (truncated)]    [⋯ on hover]
```

**Status icon values observed:**

- `img "Archiviert"` = stopped/archived state (grey icon)
- Running sessions would show a green/active icon (not captured in this session list)
- Creating sessions would show a spinner

**Our implementation:**

```
<Collapsible defaultOpen>
  <Collapsible.Trigger>  <!-- "Recents" + chevron -->
  <Collapsible.Content>
    <For each={sessions()}>
      {(session) => <SessionSidebarItem session={session} />}
    </For>
  </Collapsible.Content>
</Collapsible>
```

Each `SessionSidebarItem`:

- Status dot/icon: small colored circle using CSS custom properties
  - `running` → `--surface-success-strong` (green `#12c905`)
  - `stopped` → `--icon-base` (grey `#8f8f8f`)
  - `creating` → `<Spinner size="sm" />`
- Title: `session.branch` (truncated)
- 3-dot menu: `<DropdownMenu>` with items:
  - "Open" → `window.open(session.url)` (only for running)
  - "Resume" → `resumeSession(session.hash)` then set phase to creating (only for stopped)
  - "Terminate" → confirmation dialog → `terminateSession(session.hash)`

---

### 2.5 Sidebar Footer

**DOM ref:** `e496`–`e520` in `claude-code-full.yml`

```yaml
- generic [ref=e496]: # Desktop app promo banner
    - img [ref=e498]
    - generic [ref=e500]: Probiere Claude Code auf dem Desktop
    - button "Herunterladen" [ref=e501]
    - button "Schließen" [ref=e504] # dismiss button

- generic [ref=e508]: # user profile area
    - button "Oliver J" [ref=e510]:
        - generic [ref=e512]: # avatar
        - generic [ref=e513]: Oliver J # display name
    - generic [ref=e514]:
        - button "Darstellung" [ref=e515] # theme toggle
        - button "Beta verlassen..." [ref=e519] # beta exit
```

**Our implementation:**

- Omit desktop app banner (out of scope)
- Show user email from `session.email` (or `listSessions` response `.email`) using a small `<Avatar>` or plain text
- No theme toggle or beta buttons needed

---

## 3. Main Content Area — Detailed Component Breakdown

### 3.1 Welcome Header

**DOM ref:** `e535`–`e542` in `page-2026-04-24T06-30-27-150Z.yml`

```yaml
- generic [ref=e539]:
    - img [ref=e540] # Claude logo icon
    - heading "Willkommen zurück, Oliver" [level=1] [ref=e542]
```

**Our implementation:**

```tsx
<div class="flex items-center gap-3">
  <Logo class="h-6" />
  <h1 class="text-20-medium">{t("app.welcomeBack", { email: displayName })}</h1>
</div>
```

Where `displayName` = first part of email or full email from `listSessions()`.

---

### 3.2 Sessions Card

**DOM ref:** `e547`–`e565` in `page-2026-04-24T06-30-27-150Z.yml`

```yaml
- generic [ref=e547]:
    - generic [ref=e548]:
        - heading "Sitzungen" [level=2] [ref=e550]
        - list [ref=e551]:
            - listitem [ref=e552]:
                - button "Session {title} öffnen" [ref=e553]:
                    - generic [ref=e554]: # left side
                        - generic [ref=e558]: Ungelesen # unread badge (optional)
                        - generic [ref=e560]: Deploy LobeHub with config and CI/CD # title
                    - generic [ref=e561]: # right side
                        - generic [ref=e562]: mrsimpson/lobehub # repo name
                        - generic [ref=e563]: 3d # relative age
                        - img [ref=e564] # chevron arrow →
```

**Session item layout:**

```
┌──────────────────────────────────────────────────────────┐
│ [●unread?] [session title / branch]         [repo] [age→]│
└──────────────────────────────────────────────────────────┘
```

**Our implementation (mapping):**

- Session title → `session.branch`
- Repo name → `session.repoUrl` stripped of `https://` and `.git`
- Relative age → derived from `session.lastActivity` (format: `"3d"`, `"2h"`, etc.)
- Unread badge → show if `session.state === "running"` (active/unread = has new activity)
- Click → if `running`: `window.open(session.url)` / if `stopped`: call `resumeSession()` then `LoadingScreen`

---

### 3.3 Pull Requests Card

**DOM ref:** `e566`–`e585` in `page-2026-04-24T06-30-27-150Z.yml`

```yaml
- generic [ref=e566]:
  - heading "Pull Requests" [level=2] [ref=e568]
  - list [ref=e571]:
    - listitem [ref=e572]:
      - button "Offene Session für PR #254" [ref=e573]:
        - generic [ref=e574]:
          - generic [ref=e578]: In Prüfung     # status badge
          - generic [ref=e579]: Fix beads...   # PR title
          - generic [ref=e580]: "#254"         # PR number
        - generic [ref=e581]:
          - generic "+90 −24" [ref=e582]: S    # diff stats + size label
          - generic [ref=e583]: mrsimpson/...  # repo
          - generic [ref=e584]: 3w             # age
          - img [ref=e585]                     # arrow →
```

**Our implementation:** **Omit entirely** — no PR data available in current API.

---

## 4. New Session Input Bar — Detailed Breakdown

> This is the most critical component. It lives at the bottom of `<main>`, is **always visible**, and handles all new session creation.

**DOM ref:** `e587`–`e728` in `page-2026-04-24T06-30-27-150Z.yml`

### 4.1 Full Structure

```yaml
- generic [ref=e587]: # outer container (entire bar)
    - button: # expand/collapse bar toggle
        - img
    - generic [ref=e588]: # REPO SELECTOR ROW
        - button "Default" [ref=e589]: # profile/context selector
            - img [ref=e590]
            - generic [ref=e592]: Default
        - generic [ref=e1192]: # selected repo+branch group
            - button "opencode" [ref=e1193]: # selected repo name button
                - img [ref=e1194]
                - generic [ref=e1196]: opencode
            - textbox [ref=e1197]: "{...full repo JSON...}" # hidden repo data
            - button "main" [ref=e1198]: # selected branch button
                - img [ref=e1199]
                - generic [ref=e1201]: main
            - textbox [ref=e1202]: main # hidden branch value
        - button [active] [ref=e1203]: # "clear repo" button
            - img [ref=e594]
        - textbox [ref=e597] # free-text fallback input
    - button [ref=e598]: # attachments button
        - img [ref=e600]
    - generic [ref=e695]: # PROMPT AREA
        - generic "Prompt" [active] [ref=e697]: # contenteditable prompt
            - paragraph [ref=e698]: Add a README... # typed text / placeholder
        - button "Senden" [ref=e700]: # Send button (disabled until text)
            - img [ref=e702]
    - generic [ref=e704]: # BOTTOM TOOLBAR
        - generic [ref=e705]: # left toolbar
            - button "Planmodus" [ref=e706] # Plan mode toggle
            - button "Transkript-Ansichtsmodus" [ref=e708] # transcript view
            - button "Hinzufügen" [ref=e712] # add context
            - group "Diktieren" [ref=e716]: # dictation group
                - button "Drücken und halten..." [ref=e717]
                - button "Diktat-Einstellungen" [ref=e720]
        - generic [ref=e723]: # right toolbar
            - button "Sonnet 4.6" [ref=e724] # model selector
            - button "Usage: plan 0%" [ref=e726] # usage indicator
```

### 4.2 Repo Selector — Interaction Sequence

**Step 1 — Initial state (no repo selected):**

```yaml
- button "Repo auswählen …" [ref=e593]:
    - img [ref=e594]
    - generic [ref=e596]: Repo auswählen …
```

**Step 2 — After clicking, listbox opens:**

```yaml
- button "Repo auswählen …" [expanded] [ref=e593]
- generic [ref=e737]:
    - listbox [ref=e738]:
        - option "codemcp/ade" [ref=e739]
        - option "mrsimpson/pianobuddy" [ref=e741]
        - option "mrsimpson/opencode" [ref=e753]
      # ... many more options
```

**Step 3 — After selecting a repo:**

```yaml
- generic [ref=e1192]:
    - button "opencode" [ref=e1193] # repo short-name
    - textbox [ref=e1197]: "{full JSON}" # hidden
    - button "main" [ref=e1198] # default branch
    - textbox [ref=e1202]: main # hidden branch value
```

**Step 4 — Branch selector (click branch button):**

```yaml
- button "main" [expanded] [ref=e1198]
- generic [ref=e1207]:
    - listbox [ref=e1208]:
        - option "main" [selected] [ref=e1209]
        - option "amazon-q" [ref=e1214]
        - option "dev" [ref=e1222]
      # ... more branches
    - generic [ref=e1233]:
        - combobox "Branches durchsuchen…" [ref=e1236] # search box
```

### 4.3 Enabled/Disabled States

| State                  | Send button |
| ---------------------- | ----------- |
| No text, no repo       | `disabled`  |
| Text only, no repo     | `disabled`  |
| Repo selected, no text | `disabled`  |
| Repo + branch + text   | **enabled** |

### 4.4 Our Adaptation

Since we don't have a GitHub-integrated repo list, our input bar replaces the pickers with text fields:

```
┌──────────────────────────────────────────────────────────────────┐
│  [🌐 repo URL input field ......................] [branch input]  │
│  [prompt textarea ..........................................] [→]  │
│  [session branch: auto-suggested (read-only)]                    │
└──────────────────────────────────────────────────────────────────┘
```

**Component mapping:**

- Repo URL input → `<TextField>` (`repoUrl` signal), validates with `GIT_URL_PATTERN`
- Source branch input → `<TextField>` (`sourceBranch` signal)
- Session branch → read-only display of `suggestBranch()` result (auto-fetched on repo URL blur)
- Prompt textarea → `<TextField multiline>` or `contenteditable` div (`promptText` signal — cosmetic only for now)
- Send button → `<Button variant="primary">` disabled until `repoUrl + sourceBranch + sessionBranch` are all valid
- On submit → calls `createSession(repoUrl, sessionBranch, sourceBranch)` → transitions to `creating` phase (LoadingScreen)

**Validation (reuse existing `buildSessionKey` from `setup-form-utils.ts`):**

```ts
buildSessionKey(repoUrl(), sourceBranch(), errorMessages)
// → { valid: true, repoUrl, sourceBranch } | { valid: false, error }
```

---

## 5. Interaction Flows

### 5.1 New Session Creation Flow

```
User is on home screen (sessions list visible)
  │
  ├─ [Option A] Click "New session" button in sidebar
  │    └─ Sidebar button gets [active] state
  │       Input bar is already visible — focus moves to repo URL field
  │
  └─ [Option B] Directly click into repo URL field in input bar
       └─ Same result

User fills in repo URL (e.g. https://github.com/org/repo.git)
  └─ On blur: auto-fetch `suggestBranch(repoUrl)` → populates session branch

User fills in source branch (e.g. "main")
  └─ Send button becomes enabled

User types prompt text (optional UX)

User clicks Send
  └─ `buildSessionKey()` validates
     └─ `createSession(repoUrl, sessionBranch, sourceBranch)` called
        └─ On success: transition to `creating` phase
           └─ `<LoadingScreen>` polls `getSessionState` every 3s
              └─ When `state === "running"`: `window.location.replace(url)`
```

### 5.2 Resume Stopped Session Flow

```
User sees stopped session in sidebar (grey icon) or sessions card
  └─ Click session item OR click "Resume" from 3-dot menu
     └─ `resumeSession(session.hash)` API call
        └─ `setPhase({ kind: "creating", hash, url })`
           └─ `<LoadingScreen>` polls until running
              └─ `window.location.replace(session.url)`
```

### 5.3 Terminate Session Flow

```
User hovers over session row in sidebar → 3-dot (⋯) button appears
  └─ Click ⋯ → DropdownMenu opens
     └─ Click "Terminate"
        └─ Confirmation Dialog opens
           ├─ Cancel → dismiss dialog
           └─ Confirm → `terminateSession(session.hash)`
                       → refresh session list
```

### 5.4 Sidebar Collapse/Expand

```
User clicks "Collapse sidebar" button (or ⌘B)
  └─ `setSidebarCollapsed(true)`
     └─ sidebar shrinks to icon-rail (or fully hidden)
        └─ main content expands to fill space
```

---

## 6. Component Architecture for Our App

### 6.1 Proposed File Structure

```
packages/opencode-router-app/src/
  app.tsx                    # Root layout: sidebar + main, signal management
  sidebar/
    sidebar.tsx              # Collapsible sidebar shell
    sidebar-header.tsx       # Logo + collapse + (search omitted)
    sidebar-actions.tsx      # "New session" button
    sidebar-session-item.tsx # Single session row with status + 3-dot menu
  main/
    welcome-header.tsx       # h1 welcome + logo
    sessions-card.tsx        # h2 + session list in main area
    session-input-bar.tsx    # Bottom input bar (repo URL + branch + prompt + send)
  loading-screen.tsx         # (unchanged)
  session-utils.ts           # (unchanged)
  setup-form-utils.ts        # (unchanged — reuse buildSessionKey)
  api.ts                     # (unchanged)
  i18n/
    en.ts                    # + new keys (see §8)
    de.ts                    # + new keys (see §8)
```

### 6.2 Signal / State Architecture

All state lives in `app.tsx` and is passed down as props:

```ts
// Layout state
const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

// Data state (replaces phase machine for list/new-session phases)
const [sessions, setSessions] = createSignal<Session[]>([])
const [email, setEmail] = createSignal("")
const [loadError, setLoadError] = createSignal("")

// New session form state (inline, not a separate phase)
const [repoUrl, setRepoUrl] = createSignal("")
const [sourceBranch, setSourceBranch] = createSignal("")
const [sessionBranch, setSessionBranch] = createSignal("")
const [formError, setFormError] = createSignal("")
const [submitting, setSubmitting] = createSignal(false)

// Terminating set (unchanged)
const [terminating, setTerminating] = createSignal<Set<string>>(new Set())

// Loading / creating phase (keep as sub-state)
// { kind: "loading" } | { kind: "ready" } | { kind: "creating"; hash; url } | { kind: "error" }
const [appPhase, setAppPhase] = createSignal<AppPhase>({ kind: "loading" })
```

---

## 7. CSS / Styling Notes

### 7.1 Layout Structure

```tsx
// Root layout
<div class="flex h-dvh overflow-hidden" style={{ background: "var(--background-base)" }}>
  {/* Sidebar */}
  <aside
    class={`flex flex-col shrink-0 transition-[width] ${sidebarCollapsed() ? "w-0 overflow-hidden" : "w-60"}`}
    style={{ background: "var(--background-surface)", "border-right": "1px solid var(--border-base)" }}
  >
    {/* ... */}
  </aside>

  {/* Main */}
  <main class="flex flex-col flex-1 min-w-0 overflow-y-auto">
    {/* Welcome header + cards */}
    <div class="flex-1 p-6"> ... </div>
    {/* Input bar — pinned to bottom */}
    <div class="shrink-0 border-t p-4" style={{ "border-color": "var(--border-base)" }}>
      {" "}
      ...{" "}
    </div>
  </main>
</div>
```

### 7.2 Status Badge Colors (from `theme.css`)

| State      | Background token                   | Color token                        |
| ---------- | ---------------------------------- | ---------------------------------- |
| `running`  | `--surface-success-base` (#dbfed7) | `--text-on-success-base` (#2dba26) |
| `stopped`  | `--background-surface`             | `--text-dimmed-base`               |
| `creating` | —                                  | use `<Spinner>`                    |

Small status dot implementation:

```tsx
const statusDot = (state: Session["state"]) => {
  if (state === "creating") return <Spinner size="sm" />
  return (
    <span
      class="size-2 rounded-full shrink-0"
      style={{
        background: state === "running" ? "var(--surface-success-strong)" : "var(--icon-base)",
      }}
    />
  )
}
```

### 7.3 Session Item Row (sidebar)

```tsx
// Truncated title with mask-image gradient (matching Claude Code pattern)
<span
  class="block w-full min-w-0 whitespace-nowrap overflow-hidden"
  style={{ "mask-image": "linear-gradient(to right, black 80%, transparent 100%)" }}
>
  {session.branch}
</span>
```

---

## 8. New i18n Keys Required

Add to both `en.ts` and `de.ts`:

```ts
// en.ts additions
"app.welcomeBack": "Welcome back, {{email}}",
"app.sessions": "Sessions",
"app.recents": "Recents",
"app.newSession.repoUrl.placeholder": "https://github.com/org/repo.git",
"app.newSession.sourceBranch.placeholder": "main",
"app.newSession.prompt.placeholder": "Describe a task or ask a question",
"sidebar.collapse": "Collapse sidebar",
"sidebar.expand": "Expand sidebar",
"session.state.ready": "Ready",
"session.state.inactive": "Inactive",
"session.action.open": "Open",
"session.action.openInNewTab": "Open in new tab",
```

```ts
// de.ts additions
"app.welcomeBack": "Willkommen zurück, {{email}}",
"app.sessions": "Sitzungen",
"app.recents": "Zuletzt verwendet",
"app.newSession.repoUrl.placeholder": "https://github.com/org/repo.git",
"app.newSession.sourceBranch.placeholder": "main",
"app.newSession.prompt.placeholder": "Beschreibe eine Aufgabe oder stelle eine Frage",
"sidebar.collapse": "Seitenleiste einklappen",
"sidebar.expand": "Seitenleiste ausklappen",
"session.state.ready": "Aktiv",
"session.state.inactive": "Inaktiv",
"session.action.open": "Öffnen",
"session.action.openInNewTab": "In neuem Tab öffnen",
```

---

## 9. Out-of-Scope Elements (Do Not Implement)

| Claude Code Feature                       | Reason                           |
| ----------------------------------------- | -------------------------------- |
| Pull Requests card                        | No PR data in API                |
| Desktop app download banner               | Not applicable                   |
| "Routines" / "Customize" / "More" buttons | Not applicable                   |
| Pinned sessions section                   | Not applicable                   |
| "Default" profile button in input bar     | No equivalent concept            |
| Model selector ("Sonnet 4.6")             | Not applicable                   |
| Usage indicator                           | Not applicable                   |
| Plan mode / Transcript mode buttons       | Not applicable                   |
| Dictation button group                    | Not applicable                   |
| Search button in sidebar header           | Not applicable                   |
| "View all" recents link                   | Not needed (show all in sidebar) |
| Filter button in recents                  | Not needed                       |

---

## 10. Key Source File References

| File                            | Purpose                                   | Notes                                                             |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `src/app.tsx`                   | Current app — replace entirely            | Keep phase types as reference                                     |
| `src/setup-form.tsx`            | Current new-session form — replace inline | Reuse validation logic                                            |
| `src/setup-form-utils.ts`       | `buildSessionKey()` validator             | **Keep unchanged**                                                |
| `src/session-utils.ts`          | `computeIdleStatus()`                     | **Keep unchanged**                                                |
| `src/api.ts`                    | All API calls                             | **Keep unchanged**                                                |
| `src/loading-screen.tsx`        | Loading/creating screen                   | **Keep unchanged**                                                |
| `src/i18n/en.ts`                | English strings                           | Extend with new keys                                              |
| `src/i18n/de.ts`                | German strings                            | Extend with new keys                                              |
| `@opencode-ai/ui/collapsible`   | Sidebar section collapse                  | Use `Collapsible` + `Collapsible.Trigger` + `Collapsible.Content` |
| `@opencode-ai/ui/dropdown-menu` | Session 3-dot menu                        | Use `DropdownMenu` + `DropdownMenu.Trigger` + `DropdownMenu.Item` |
| `@opencode-ai/ui/tag`           | Status badge                              | Use with inline style for color                                   |
| `@opencode-ai/ui/logo`          | Logo                                      | Already used                                                      |
| `@opencode-ai/ui/button`        | All buttons                               | Already used                                                      |
| `@opencode-ai/ui/text-field`    | Text inputs                               | Already used                                                      |
| `@opencode-ai/ui/spinner`       | Creating state                            | Already used                                                      |
| `@opencode-ai/ui/dialog`        | Terminate confirmation                    | Already used                                                      |

---

## 11. Raw Snapshot File Index

| File                                                | Contents                                                                                                                       | When captured                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `.playwright-cli/claude-code-full.yml`              | Full page, depth=8, home state (no repo selected)                                                                              | Initial load                             |
| `.playwright-cli/new-session-flow.yml`              | Same as above but "New session" button is `[active]`                                                                           | After clicking "New session"             |
| `.playwright-cli/page-2026-04-24T06-30-27-150Z.yml` | Deepest capture: full sidebar with all Recents items expanded + full input bar with repo/branch selected + sessions/PR cards   | After selecting repo + expanding recents |
| `.vibe/docs/claude-code-screenshot.png`             | DO NOT READ! **Bitmap screenshot** — visual reference of the full page layout (home state, sidebar expanded, sessions visible) | 2026-04-24                               |
