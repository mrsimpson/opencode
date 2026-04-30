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
