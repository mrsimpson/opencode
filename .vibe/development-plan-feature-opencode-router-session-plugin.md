# Development Plan: opencode (feature/opencode-router-session-plugin branch)

_Generated on 2026-04-30 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Build an opencode plugin (`packages/opencode-router-plugin`) that runs inside each opencode pod instance and uses the official plugin hook system to push session data (title, all user + assistant text messages — no tool calls) back to the opencode-router in real time. The router stores this data per pod and exposes it via two new SSE streaming endpoints so the `opencode-router-app` can display session titles and a live message thread without polling.

**Scope constraint:** Only `packages/opencode-router`, `packages/opencode-router-app`, and a new `packages/opencode-router-plugin` package are modified. No changes to core opencode packages (`packages/opencode`, `packages/plugin`, etc.).

## Key Decisions

### Endpoints

Three new routes added to `opencode-router/src/api.ts`:

- **`POST /api/sessions/:hash/progress`** — pod plugin pushes events. Requires `X-Pod-Secret` header matching the per-pod ephemeral secret. Body: `ProgressPushEvent` discriminated union (see Types). Router stores the event and notifies open SSE connections. Returns `{ ok: true }`.

- **`GET /api/sessions/stream`** — SSE stream for the session list. Replaces the 5-second polling interval in `app.tsx`. On connect: emits a `sessions` event with the full `{ email, sessions: Session[] }` snapshot immediately. Subsequently emits a new snapshot whenever any session changes (pod state, title, last activity). Requires user auth (same as all other `/api/*` routes). One connection per browser tab; stays open until client disconnects.

- **`GET /api/sessions/:hash/progress/stream`** — SSE stream for a single session's message thread. On connect: emits a `snapshot` event carrying the full `SessionProgress` (title + all stored messages). Subsequently emits incremental `message` events as new messages arrive. Requires user auth + session ownership check (hash must belong to the authenticated user's sessions). Opened by the expand panel in `SessionItem`; closed when the panel collapses or the session is terminated.

`GET /api/sessions` (REST) is kept for the initial page load. After the first render, the app switches to `GET /api/sessions/stream`.

**Route ordering in `api.ts`:** All three new routes must be matched before the existing `GET /api/sessions` handler (exact match on `/api/sessions`) and before the `/:hash` regex catch-all. `/api/sessions/stream` does not match the 12-hex-char hash regex so there is no collision, but ordering is still explicit.

### Auth: ephemeral per-pod secret

At pod creation time (`ensurePod()`), the router generates a random 32-byte hex secret, stores it in `podSecretStore` (in-memory `Map<hash, secret>`), and injects it into the pod container as `OPENCODE_POD_SECRET`. The plugin sends it as `X-Pod-Secret` on every POST. The router rejects POSTs where the header does not match the stored secret.

**Why meaningful:** a static shared secret (same value in all pods) would allow any pod to forge data for any other pod's hash. A per-pod ephemeral secret means pod A cannot push data claiming to be pod B. The secret is never written to k8s annotations or Secrets — it lives only in router RAM and pod env. It is regenerated on every `ensurePod()` call (covering both fresh creation and `resumeSession()`).

The secret is cleared from `podSecretStore` in `terminateSession()` and `deleteIdlePods()`. The prepull test pod (`prepullImage()`) also gets a secret unconditionally — it is unused (no plugin runs) and cleared on termination.

### Data stored per hash

New in-memory store in `message-store.ts` — `Map<hash, SessionProgress>`:

```ts
type StoredMessage = {
  partID: string // opencode part ID — dedup key
  messageID: string // opencode message ID
  sessionID: string // opencode session UUID
  role: "user" | "assistant"
  text: string
  time: number // Unix ms
}

type SessionProgress = {
  title?: string // absent until first session.title event
  messages: StoredMessage[] // chronological, empty until first message pushed
}
```

Deduplication: `addMessage()` skips a message whose `partID` already exists — making replay idempotent.

### Push protocol: POST body types

The plugin POSTs a discriminated union:

```ts
type ProgressPushEvent =
  | { type: "session.title"; sessionID: string; title: string }
  | { type: "message.user"; partID: string; messageID: string; sessionID: string; text: string; time: number }
  | { type: "message.assistant"; partID: string; messageID: string; sessionID: string; text: string; time: number }
```

`message.user` and `message.assistant` are separate variants (not a `role` field) because the discriminant alone encodes the hook source — user messages come from `message.part.updated`, assistant messages from `experimental.text.complete`. No secondary field needed in the router handler.

These types are defined in `opencode-router/src/progress-types.ts` (authoritative) and duplicated in `opencode-router-plugin/src/types.ts`. No shared package dependency.

### Plugin hooks

The plugin registers two hooks after completing startup replay:

- **`event` hook** — handles three event types:
  - `session.created` / `session.updated` → extracts `properties.info.title` and pushes a `session.title` event.
  - `message.updated` → caches `messageID → role` in a local `Map` (needed to attribute text parts to the correct role).
  - `message.part.updated` where `part.type === "text"` and the cached role is `"user"` → pushes a `message.user` event. User parts fire once with complete text (not streamed).

- **`experimental.text.complete` hook** — fires once per assistant text part after streaming ends. Pushes a `message.assistant` event with the finalized text. This avoids intercepting every streaming delta.

### Resume state recovery

When a pod is suspended (`deleteIdlePods`), both `podSecretStore.delete(hash)` and `messageStore.delete(hash)` are called. On resume, `ensurePod()` generates a new secret. The **plugin replays full history on startup**, before returning the hooks object:

1. Calls `input.client.session.list()` to get all opencode sessions on this pod.
2. For each session, calls `input.client.session.messages()` to get all messages and parts.
3. Iterates parts, filters for `type === "text"` on user/assistant messages, and POSTs each as a `ProgressPushEvent` with the original `time` from `info.time.created`.
4. The router's `partID` dedup makes replay idempotent.

No special router-side logic needed for resume. The replay also runs on a first-time pod start (where the message history is empty) — safe, since there is nothing to replay.

### SSE broadcaster

A new `stream-broadcaster.ts` module (leaf — no imports from `pod-manager.ts` or `api.ts`) provides two broadcaster instances:

- `sessionsChangedBroadcaster` — void signal. Each SSE handler re-fetches its own user's sessions on signal. Called from: `messageStore.setTitle()`, `messageStore.addMessage()`, `updateLastActivity()` (already throttled — only fires when throttle passes), `terminateSession()`, `deleteIdlePods()`, `resumeSession()`.
- `progressBroadcaster` — carries `{ hash, message: StoredMessage }`. Clients filter by hash. Called only from `messageStore.addMessage()`.

`pod-manager.ts` imports `stream-broadcaster.ts` — no circular dependency (pod-manager currently imports only `config.ts` and `dev-proxy.ts`).

### SSE reconnection

`EventSource` reconnects automatically on network drop. On reconnect, both SSE handlers re-send their full initial state (`sessions` snapshot / `snapshot` event). No `Last-Event-ID` resumption is implemented or needed — full replay on every connection is the correct behaviour given the in-memory store.

### SessionInfo and Session interface changes

`SessionInfo` in `pod-manager.ts` gains `title?: string`, merged from `messageStore.get(hash).title` at response-build time. Messages are NOT embedded in the sessions list — they are only available via the `/progress/stream` SSE endpoint (embedding would bloat the polling payload and is redundant with the stream).

`Session` interface in `opencode-router-app/src/api.ts` gains `title?: string` only.

### Plugin package

- Name: `@opencode-ai/opencode-router-plugin`
- Build: `tsup`, ESM bundle, self-contained
- Dependencies: `@opencode-ai/plugin` and `@opencode-ai/sdk` as `devDependencies` (types only — available at runtime via the host process)
- Export: `export default { id: "opencode-router", server: RouterPlugin }`
- Installed via `opencode.json` `plugin` array in the pod image

### Compression

No custom compression is implemented:

- **Plugin → Router (internal):** Cluster-local HTTP, 10Gbps network. Bulk startup replay is ≤100KB — negligible transfer time. Adding gzip on both sides of an internal path adds code complexity with no meaningful benefit.
- **Router → Browser (SSE streams):** The router runs behind an ingress/oauth2-proxy in production (evidenced by `X-Auth-Request-Email` injection). That reverse proxy compresses all HTTP responses including SSE transparently. No compression code in the router.

## Notes

### Session list SSE never refreshed (bug, fixed 2026-05-01)

`sessionsChangedBroadcaster` was defined as a module-level singleton in `api.ts` but never called from `pod-manager.ts` (different module). As a result the SSE `/api/sessions/stream` only fired when the plugin pushed a message/title — **pod state transitions (creating→running, terminate, idle cleanup, resume) never triggered a refresh**.

**Fix**: Moved broadcaster singletons to `stream-broadcaster.ts` as named exports (`sessionsChangedBroadcaster`, `progressBroadcaster`). `pod-manager.ts` imports via a local `let emitSessionsChanged` variable (injectable via `_setEmitSessionsChanged` for tests). Now `updateLastActivity`, `terminateSession`, `deleteIdlePods`, and `resumeSession` all call `emitSessionsChanged()`.

### Root cause of multiple opencode sessions per pod (bug, fixed 2026-05-01)

**Why two sessions were created**: The original `bootstrappedHashes: Set<string>` only tracked _whether_ bootstrap started, not its result. When two concurrent callers (e.g. the SSE session-list stream + the SSE events polling loop) both called `getSessionInfo` while the pod was first becoming `running`:

1. First caller: `bootstrappedHashes` empty → calls `bootstrapPodSession` → adds hash to set → awaits `POST /session` (async)
2. Second caller (same millisecond, JavaScript event loop): `bootstrappedHashes.has(hash) === true` → `bootstrapPodSession` returns `null` immediately → URL resolution falls through to `newSessionUrl`
3. SSE events fires `complete` with `newSessionUrl` → LoadingScreen navigates there → **opencode auto-creates a new empty session**
4. User interacts with that second session; bootstrap eventually finishes and the first session (with the initial prompt) is buried

Additionally, any time bootstrap returned `null` (failure) the code fell through to `newSessionUrl` — which always creates a new session on interaction.

**Fix**: Changed `bootstrappedSessions` to `Map<hash, Promise<string | null>>`. The Promise is stored **synchronously** before any `await`, so:

- All concurrent callers return/await the **same Promise** — only one `POST /session` ever fires per pod hash
- URL resolution always `await`s the bootstrap Promise; on failure it returns `null` (not a bare URL)
- On success the Promise resolves to the session ID, which is cached permanently (until pod terminate/idle-delete) so all future URL lookups return the same stable deep link

### No bare/fallback URLs — errors propagated properly (fixed 2026-05-02)

**Problem**: Several code paths used bare pod root URLs or `newSessionUrl` as fallbacks:

- `getSessionInfo`/`listUserSessions`: when bootstrap failed → bare pod root `https://<hash>-oc.<domain>/`
- `getSessionInfo`/`listUserSessions`: when pod running with no sessions and no `initialMessage` → `newSessionUrl` (`/.../session`) which auto-creates a session on user interaction
- `LoadingScreen` `onError` fallback: navigated to `props.url` (which could be a bare root) instead of surfacing an error
- `app.tsx` `handleOpenSession`: used `session.url.includes("/session/")` string-sniff instead of typed null check

**Fix**: `SessionInfo.url` (and frontend `Session.url`) is now `string | null`:

- `null` = pod not running, pod unreachable, or bootstrap still in-flight
- Non-null = always a valid deep link `/.../session/<sessionId>`
- `newSessionUrl` function removed entirely

`AppPhase.creating` no longer carries a `url` field — the LoadingScreen gets the URL exclusively from the events SSE `complete` event.

The events SSE in `api.ts` now:

- Only emits `complete` when `info.url !== null`
- Keeps polling (up to 30 s) while `url` is null (bootstrap in-flight)
- Emits `error` with `"session URL could not be resolved"` after the timeout

`LoadingScreen` now accepts `onError` prop and surfaces the error to `app.tsx` (which sets `kind: "error"`) instead of navigating to a fallback URL.

### Session list SSE not reactive to session creation (bug, fixed 2026-05-02)

Two separate gaps in `api.ts`:

1. **`POST /api/sessions` never called `sessionsChangedBroadcaster.emit()`** — creating a new session had no effect on the SSE session list. Fixed: emit is called immediately after `ensurePVC` + `ensurePod`.

2. **`sessionUrl(hash)` helper returned bare pod root URL** — the helper `${proto}://${hash}${routeSuffix}.${domain}` was used in the `POST /api/sessions` response (`url` field), the `POST .../resume` response, and a `GET /api/sessions/:hash` fallback. Since `SessionInfo.url` is now `string | null`, all three now return `url: null`. The `sessionUrl` helper is removed.

Full MECE audit confirmed: every session-mutating operation now emits `sessionsChangedBroadcaster`:

- Create: `api.ts` after `ensurePod`
- Resume: `pod-manager.terminateSession` → `emitSessionsChanged()`
- Terminate: `pod-manager.terminateSession` → `emitSessionsChanged()`
- Idle-delete: `pod-manager.deleteIdlePods` per pod → `emitSessionsChanged()`
- Activity update: `pod-manager.updateLastActivity` → `emitSessionsChanged()`
- Plugin push (title/message): `api.ts` progress push handler

### Plugin session filtering (fixed 2026-05-02)

The plugin previously pushed events for ALL sessions on the pod (startup replay + event hooks), not just the bootstrapped one. A user who happened to manually create a second session would have its messages pushed to the router under the same hash — contaminating the message store.

**Fix** (both `opencode-router-plugin.ts` and `src/index.ts`):

`allowedSessionIds: Set<string> | null` — module-level variable:

- `null` = replay not yet complete → all session IDs accepted (events fired during the 5 s startup window are not silently dropped)
- Set populated by the startup replay from `session.list()` — only the sessions that existed at boot are added
- All event hooks (`event`, `experimental.text.complete`) check `isAllowed(sessionID)` before pushing
- Replay failure leaves `allowedSessionIds === null` (accept-all) which is safe

### Broadcaster injection for testing

`_setEmitSessionsChanged(fn: () => void)` added to `pod-manager.ts` following the same `_set*` pattern as `_setApiClient`, `_setActivityFetch`, etc. Tests can now spy on emit calls without the global broadcaster singleton leaking across test files.

### Plugin `allowedSessionIds` filter blocks all messages on fresh pods (fixed 2026-05-02)

**Root cause**: The filter was designed to accept only session IDs that existed at startup. On a **fresh pod** no sessions exist yet — the router's `POST /session` bootstrap call happens _after_ the pod is ready, which is _after_ the plugin initialises. So:

1. `setTimeout` fires after 5s → `session.list()` returns `[]`
2. `allowedSessionIds = new Set([])` — empty set (was unconditional)
3. `isAllowed(anyID)` → `false` for every session ID
4. All events blocked — no messages ever reach the router

The `null = accept-all` window only covers the first 5s. After that the empty set silently discarded everything.

**Fix** (both `src/index.ts` and `opencode-router-plugin.ts`):

1. **Empty replay → stay null**: `allowedSessionIds` is only populated if `sessions.length > 0`. A fresh pod leaves it `null` (accept-all).

2. **`session.created` locks in the session**: Added `lockToSession(sessionID)` called on every `session.created` event. On a fresh pod (null → accept-all), the first `session.created` is always the router-bootstrapped session; `lockToSession` sets `allowedSessionIds = new Set([bootstrappedId])`, blocking any subsequently manually-created sessions. On a resumed pod, `allowedSessionIds` is already a populated Set from replay; `lockToSession` just adds the ID (idempotent).

3. **`lockToSession` helper**:

```ts
function lockToSession(id: string) {
  if (allowedSessionIds === null) allowedSessionIds = new Set([id])
  else allowedSessionIds.add(id)
}
```

### Session creation not propagated to session list SSE (fixed 2026-05-02)

**Root cause**: Two bugs combined to make new sessions invisible to the observer's SSE stream.

**Bug 1 — subscribe-after-emit race**: `GET /api/sessions/stream` first `await sendSnapshot()` (which calls k8s `list` — takes ~100–300ms), then subscribed to `sessionsChangedBroadcaster`. If the actor's `POST /api/sessions` completed (emitting `sessionsChangedBroadcaster`) while the observer was still in that initial `await listUserSessions`, the emit hit zero subscribers and was silently dropped.

**Fix**: Subscribe to `sessionsChangedBroadcaster` **before** the initial `sendSnapshot()` call, not after. Any emit that fires during the initial fetch is now captured and triggers a follow-up snapshot.

**Bug 2 — concurrent snapshot interleave**: If two `sendSnapshot` calls ran concurrently (initial + broadcaster-triggered), whichever k8s list call finished last would overwrite the other's write, potentially sending an older snapshot after a newer one.

**Fix**: Added a `snapshotInFlight` + `pendingSnapshot` serialization guard inside `sendSnapshot`. If a fetch is already in-flight when a new emit arrives, the new one sets `pendingSnapshot = true`. After the in-flight fetch completes, it checks `pendingSnapshot` and re-runs once — guaranteeing exactly one follow-up and correct ordering.

### Session deletion not reflected in SSE session list (fixed 2026-05-02)

**Root cause**: `listUserSessions` filtered terminating **pods** (skipping pods with `deletionTimestamp`) but not terminating **PVCs**. When `terminateSession` calls `deleteNamespacedPersistentVolumeClaim` followed immediately by `emitSessionsChanged()`, the PVC is still present in the k8s API with `deletionTimestamp` set (deletion is async in k8s). `listUserSessions` therefore returned the terminated session as `stopped`, so the SSE session list snapshot still included it after deletion.

**Fix**: Added `!pvc.metadata?.deletionTimestamp` to the `userPVCs` filter in `listUserSessions` — symmetric with the identical guard already present for pods on the line below.

### ERR_STREAM_WRITE_AFTER_END crash in /events SSE (fixed 2026-05-02)

**Root cause**: The `/api/sessions/:hash/events` handler used `setInterval(async () => {...}, 1000)`. An async callback registered by `setInterval` is **not awaited** — the next tick fires 1 s later regardless of whether the previous one finished. When the client disconnected mid-poll:

1. `res.on("close")` set `closed = true`
2. An async `getSessionInfo` was already in-flight from the previous tick
3. It completed and called `sendEvent()` → `res.write()` → crash: `ERR_STREAM_WRITE_AFTER_END`

The `clearInterval` + `res.end()` calls also had a race: `clearInterval` doesn't cancel the currently running async invocation.

**Why `setInterval` at all**: The pod state (`creating → running`) transitions in Kubernetes asynchronously. `sessionsChangedBroadcaster` fires on `terminateSession`, `deleteIdlePods`, `resumeSession`, and `updateLastActivity` — but NOT when k8s first marks a pod Ready. So a polling loop is genuinely needed for this endpoint.

**Fix**: Replaced `setInterval` with a recursive `setTimeout`-based `poll()` function. `setTimeout(poll, 1000)` is only called at the end of each async tick — after all awaits complete. This means:

- The next poll is never scheduled until the current one fully finishes
- `res.writableEnded` is checked at the top of every tick AND after every `await` (before any write)
- `sendEvent()` returns `false` and the caller immediately returns if the connection is ended
- `finish()` helper combines write + end with a `writableEnded` guard
- No `closed` boolean needed — `res.writableEnded` is the authoritative source of truth

The other two SSE handlers (`/sessions/stream`, `/progress/stream`) were also patched to guard writes with `res.writableEnded` checks.

### Current Architecture Summary

**`packages/opencode-router`** (Node.js HTTP proxy, Kubernetes):

- `src/index.ts` — HTTP server, proxies `<hash>-oc.<domain>` subdomains to pod IPs
- `src/api.ts` — REST API: `GET /api/sessions`, `POST /api/sessions`, SSE `GET /api/sessions/:hash/events`, resume, terminate
- `src/pod-manager.ts` — k8s PVC/Pod management; `SessionInfo` type includes `description?: string`
- Session hash = 12-hex chars from `sha256(email + repoUrl + branch)`

**`packages/opencode-router-app`** (SolidJS SPA):

- `src/api.ts` — `Session` interface: `{ hash, email, repoUrl, branch, sourceBranch, state, url, lastActivity, createdAt, idleTimeoutMinutes, description? }`
- `src/session-item.tsx` — renders repo name + `session.description`. Has expand panel with idle status + terminate button.
- `src/app.tsx` — polls `GET /api/sessions` every 5s

**`packages/opencode` plugin system** (`packages/plugin/src/index.ts`):

- `Plugin = (input: PluginInput) => Promise<Hooks>`
- `PluginInput`: `client` (SDK), `project`, `directory`, `worktree`, `serverUrl`, `$` (BunShell)
- Key hooks: `event` (all bus events), `experimental.text.complete` (fires when assistant text part is finalized)
- Plugins loaded from `opencode.json` → `plugin: ["@opencode-ai/opencode-router-plugin"]`

### Confirmed event shapes

```
session.updated / session.created  → properties.info: Session  (includes title: string)
message.updated                    → properties.info: Message  (includes id, role)
message.part.updated               → properties.part: Part     (discriminated on part.type)
  text part: { id, sessionID, messageID, type:"text", text, synthetic?, ... }
  user parts fire once (complete); assistant parts fire repeatedly during streaming

experimental.text.complete
  input:  { sessionID, messageID, partID }
  output: { text }   ← final complete text; fires once after streaming ends
```

## Explore

<!-- beads-phase-id: opencode-8.1 -->

### Tasks

<!-- beads-synced: 2026-04-30 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Plan

<!-- beads-phase-id: opencode-8.2 -->

### Tasks

<!-- beads-synced: 2026-04-30 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Code

<!-- beads-phase-id: opencode-8.3 -->

### Tasks

<!-- beads-synced: 2026-04-30 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Commit

<!-- beads-phase-id: opencode-8.4 -->

### Tasks

<!-- beads-synced: 2026-04-30 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
