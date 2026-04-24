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
- The prompt textarea is not part of our current API — keep it as a UX affordance but the submit action = `createSession()` with the branch/repo (prompt text could be passed as a hint or ignored for now)

### Available UI components (relevant)

`Button`, `Logo`, `Tag`, `Spinner`, `Dialog`, `TextField`, `Collapsible`, `DropdownMenu`, `Tooltip`, `Icon`, `IconButton`, `Card`

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
