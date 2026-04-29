# Development Plan: opencode-router-app (default branch)

_Generated on 2026-04-29 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

Improve the UX of the session list on all screen sizes, with particular focus on mobile. The primary change is a progressive-disclosure pattern: each session row shows only the essentials (status + repo + truncated first message), with a `…` button on the right that expands an inline detail panel containing the full message, dates, idle status, and a large terminate button. The mobile toggle that hid the entire list is removed.

## Key Decisions

### 1. Always show sessions (remove mobile toggle)

The `▸ Sessions (n)` toggle in `app.tsx` is removed. `SessionList` is always rendered directly for both mobile and desktop in the "ready" phase.

### 2. `…` button as the expand trigger

A `…` button sits on the far right of every session row (both mobile and desktop). It is visually distinct from the row tap target. Tapping/clicking `…` toggles the inline detail panel. Tapping/clicking the **row itself** opens/resumes the session as before.

### 3. One panel open at a time

`expandedHash` is a single signal held in `SessionList`. Opening one panel closes any previously open one. This keeps the list simple and avoids layout complexity.

### 4. Inline expandable detail panel

The detail panel renders **below** the row, inside the same list item container. It contains:

- Full session description (multi-line, word-wrap, no truncation)
- Created-at + idle/stopped status line
- A large, full-width terminate button (red, touch-friendly ≥ 44px height)

The expansion is animated with a CSS `max-height` transition to reduce jarring layout shifts.

### 5. Terminate moves into the detail panel

The existing hover-reveal `✕` terminate button is removed from the row. Terminate is only accessible via the expanded detail panel. This is correct UX: destructive actions should require deliberate intent (one extra tap). The existing confirm `Dialog` is preserved.

### 6. `…` button is `self-start` and stops propagation

The `…` button must call `e.stopPropagation()` so clicking it does not also fire the row's `onClick` (which would open the session).

### 7. Desktop: right-side metadata moves into detail panel

On desktop the current right-side dates/idle label are removed from the collapsed row. They appear inside the expanded panel instead. This gives the row more breathing room and is consistent with mobile.

### 8. No responsive gating on expand behaviour

The `…` / detail panel pattern is the same on all screen sizes. No `md:hidden` / `md:block` splits needed for this feature.

### 9. Animation

Use `overflow: hidden` + `max-height` CSS transition (e.g. `transition: max-height 200ms ease`) for smooth expand/collapse. SolidJS `Show` is not used for the panel content — instead the panel is always in the DOM but visually collapsed, so the transition works.

### 10. No new i18n keys needed

"Terminate" and all other strings already exist. No new strings are required.

## Notes

- `SessionSidebar` (compact variant) is desktop-only and is out of scope — no changes needed there.
- The compact `SessionItem` variant is also out of scope.
- The full `SessionItem` variant is the primary target.
- The existing confirm `Dialog` for terminate is preserved as-is.
- Tailwind `md:` = `min-width: 768px`.
- `mobileSessionsOpen` signal in `app.tsx` becomes unused and should be removed.

## Explore

### Tasks

- [x] Read and understand session list components
- [x] Read app-level usage in `app.tsx`
- [x] Identify UX pain points on mobile
- [x] Propose and iterate design with user
- [x] Incorporate UX expert critique (animation, affordance clarity)
- [x] Finalise: `…` button as expand trigger, tap row to open, one-at-a-time, desktop too
- [x] Document all decisions

### Completed

- [x] Created development plan file
- [x] Explored all session-related source files
- [x] Full design agreed with user

## Implement

### Tasks

- [x] `app.tsx`: Remove mobile sessions toggle and `mobileSessionsOpen` signal; always render `SessionList` for both breakpoints
- [x] `session-list.tsx`: Add `expandedHash` / `setExpandedHash` signal; pass `expanded` + `onToggleExpand` + `onTerminate` down to each `SessionItem`; remove per-item `trailing` terminate button
- [x] `session-item.tsx` (full variant): Add `expanded`, `onToggleExpand`, `onTerminate` props; add `…` button (stops propagation); render inline detail panel with full description + dates + idle label + large terminate button; add CSS `max-height` transition; remove right-side metadata from collapsed row
- [x] Run `bun typecheck` to verify no regressions

### Completed

- Removed `mobileSessionsOpen` signal and mobile toggle button from `app.tsx`; `SessionList` is now always rendered unconditionally (no `Show` wrapper needed — `SessionList` itself guards on `sessions.length > 0`)
- `session-list.tsx`: replaced the hover-reveal trailing terminate button with `expandedHash`/`setExpandedHash` signal; `toggleExpand` opens one panel at a time; `expanded`, `onToggleExpand`, `onTerminate` passed to each `SessionItem`
- `session-item.tsx` (full variant): added three new optional props; row now ends with a `…` button (stops propagation, `aria-expanded`); right-side date/idle metadata removed from collapsed row; inline detail panel always in DOM with `max-height` CSS transition (0 → 300px, 200ms ease); panel contains full description, created+idle line, and a large full-width red terminate button (min-height 44px)
- TypeScript: zero errors (`tsc --noEmit` clean)

## Finalize

### Tasks

- [x] Search all `.tsx`/`.ts` source files for `console.log`, `console.debug`, `TODO`, `FIXME`, `debugger` — none found
- [x] Review modified files for commented-out code or temporary blocks — none found
- [x] Confirm `.vibe/docs/requirements.md` and `.vibe/docs/design.md` do not exist — directory absent, no docs to update
- [x] Run `bun test src/` — 24 tests pass, 0 failures
- [x] Run `tsc --noEmit` — zero type errors
- [x] Update plan file Finalize section

### Completed

- No debug output, TODO/FIXME comments, or temporary code found in any modified or related source file
- No `.vibe/docs/` documentation files exist; documentation review step is a no-op
- All 24 existing tests pass without regression after implementation changes
- TypeScript clean (zero errors)

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
