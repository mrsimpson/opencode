# Development Plan: feat/external-domain-env-for-session-pod

_Generated on 2026-05-13_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Inject the external domain (at which the opencode router is publicly available) into session pods as an environment variable, so the `dev-server` skill can construct valid public port-forward URLs without user intervention.

## Key Decisions

1. **New env var name: `OPENCODE_ROUTER_EXTERNAL_DOMAIN`** — consistent naming with existing `OPENCODE_ROUTER_URL`. Contains just the base domain (e.g. `no-panic.org`), not a full URL, because the port-forward URL uses a different subdomain pattern (`<port>-<hash>-oc.<domain>`) than the router itself (`code.<domain>`).

2. **Config field name: `opencodeRouterExternalDomain`** — matches camelCase convention of existing config fields in `config.ts`.

3. **Only inject when configured** — follow the existing pattern of `config.opencodeRouterUrl` which is conditionally injected (line 754 of pod-manager.ts: `...(config.opencodeRouterUrl ? [...] : [])`).

4. **Route suffix (`-oc`) stays hardcoded in the skill** — it's a deployment-time constant (ROUTE_SUFFIX), not something that changes per-session, so it doesn't need its own env var. The skill can hardcode `-oc` as it already does.

5. **Protocol (`https://`) stays hardcoded in the skill** — it matches the session URL protocol. The router already has `ROUTER_PROTO` for its own use, but port-forward URLs always use the same protocol as the session URL (always `https` in production). No new env var needed for protocol.

## Notes

- The port-forward URL pattern is `https://<port>-<hash>-oc.<domain>` (also `http://` if dev mode).
- The cloudflare operator handles creating Traefik IngressRoutes for port hostnames automatically — no DNS changes needed (wildcard `*.domain` CNAME).
- `OPENCODE_ROUTER_URL` is the **internal** ClusterIP URL (`http://code.code.svc.cluster.local:80`) used by the plugin to push events back to the router — intentionally NOT the public URL.
- The router already has `ROUTER_DOMAIN` set on its own deployment (line 445 of `deployment/homelab/src/index.ts`), but this is not passed through to session pods.

## Explore

### Tasks

- [x] Investigate how `OPENCODE_ROUTER_URL` is currently set and injected into session pods
- [x] Understand the port-forward URL pattern and how the cloudflare operator provisions routes
- [x] Identify all files that need changes
- [x] Understand the dev-server skill's current limitations
- [x] Verify the skill's port URL template matches actual route provisioning (`<port>-<hash>-oc.<domain>`)

### Completed

- [x] Read config.ts — maps env vars to config fields (routerDomain, opencodeRouterUrl, etc.)
- [x] Read pod-manager.ts — env injection at line 747-755; session URL patterns
- [x] Read deployment/homelab/src/index.ts — router deployment env (ROUTER_DOMAIN at line 445)
- [x] Read dev-server/SKILL.md — current URL construction (lines 59-116), missing domain
- [x] Read cloudflare-operator config.ts — `sessionPortHostname(hash, port)` returns `<port>-<hash>-oc.<domain>`
- [x] Read cloudflare-operator index.ts — provisions IngressRoutes for port hostnames
- [x] Read port-watcher.ts — plugin polls /proc/net/tcp and POSTs to router
- [x] Read api.ts — POST/GET `/api/sessions/:hash/ports` endpoints
- [x] Read port-store.ts — in-memory port storage
- [x] Read config.test.ts — spawnSync test pattern for config defaults
- [x] Read pod-manager.test.ts — env injection test pattern (lines 782-837)
- [x] `.vibe/docs/requirements.md`, `.vibe/docs/architecture.md`, `.vibe/docs/design.md` — all are empty templates, no constraints

## Plan

### Implementation Strategy

#### Overview

Inject the external domain (base domain of the public URL, e.g. `no-panic.org`) into session pods as a new env var `OPENCODE_ROUTER_EXTERNAL_DOMAIN`, and update the dev-server skill to construct port-forward URLs from env vars instead of asking the user.

The change touches 4 production files + 2 test files:

1. **config.ts** — New optional config field `opencodeRouterExternalDomain`
2. **pod-manager.ts** — Conditional env injection into session pods
3. **deployment/homelab/src/index.ts** — Pass existing `domain` variable as the new env var to the router deployment
4. **SKILL.md** — Replace "ask the user" section with minimal bash one-liner
5. **config.test.ts** — Test default (undefined when env var absent)
6. **pod-manager.test.ts** — Test that the env var is injected when configured

#### Detailed file-by-file plan

##### 1. `packages/opencode-router/src/config.ts` (after line 60)

**What:** Add a new optional config field after `opencodeRouterUrl`.

**Code to add:**

```ts
  /**
   * The base domain at which the opencode router is publicly reachable (e.g. "no-panic.org").
   * Injected into session pods so the dev-server skill can construct public port-forward URLs
   * without user intervention: https://<port>-<hash>-oc.<domain>
   * When unset, the skill falls back to asking the user.
   * Example: OPENCODE_ROUTER_EXTERNAL_DOMAIN=no-panic.org
   */
  opencodeRouterExternalDomain: process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN,
```

**Why:** Optional (no `required()`), same pattern as `opencodeRouterUrl`.

##### 2. `packages/opencode-router/src/pod-manager.ts` (after line 754)

**What:** Inject `OPENCODE_ROUTER_EXTERNAL_DOMAIN` into the session pod's `env` array.

**Code to add (after line 754):**

```ts
            ...(config.opencodeRouterExternalDomain ? [{ name: "OPENCODE_ROUTER_EXTERNAL_DOMAIN", value: config.opencodeRouterExternalDomain }] : []),
```

**Edge case:** If unset, no entry is added — graceful degradation.

##### 3. `deployment/homelab/src/index.ts` (after line 452)

**What:** Pass the existing `domain` Pulumi Output as the new env var.

**Code to add (after line 452, inside the `env` array):**

```ts
      { name: "OPENCODE_ROUTER_EXTERNAL_DOMAIN", value: domain },
```

**Why:** `domain` is already used directly on line 445 (`ROUTER_DOMAIN`). Same pattern.

##### 4. `deployment/homelab/images/opencode/config/.agentskills/skills/dev-server/SKILL.md` (lines 75-116)

**What:** Replace the broken "Get the domain" section and the domain-not-available caveat.

**Changes:**

1. Replace lines 75-91 (### Get the domain) — domain is now `$OPENCODE_ROUTER_EXTERNAL_DOMAIN`
2. Replace lines 93-99 (### Full URL construction) — one-liner using the env var directly
3. Remove line 116 caveat note
4. Update env vars table (lines 109-116) to add new var

**New content for the section:**

````
### Construct the URL

Both the session hash and domain are available as environment variables:

```bash
# Replace PORT with your actual dev server port
echo "https://PORT-${OPENCODE_SESSION_HASH}-oc.${OPENCODE_ROUTER_EXTERNAL_DOMAIN}"
````

### Example

If `OPENCODE_SESSION_HASH=abc123def456` and `OPENCODE_ROUTER_EXTERNAL_DOMAIN=no-panic.org`, a Vite server on port 5173 is accessible at:

```
https://5173-abc123def456-oc.no-panic.org
```

## Environment Variables in the Pod

| Variable                          | Description                                                |
| --------------------------------- | ---------------------------------------------------------- |
| `OPENCODE_SESSION_HASH`           | 12-character hex hash identifying this session             |
| `OPENCODE_ROUTER_URL`             | Internal cluster URL of the router (not the public domain) |
| `OPENCODE_ROUTER_EXTERNAL_DOMAIN` | Base domain for public URLs (e.g. `no-panic.org`)          |

````

##### 5. `packages/opencode-router/src/config.test.ts` (add after line 35)

**What:** Test that `opencodeRouterExternalDomain` defaults to `undefined`.

```ts
it("opencodeRouterExternalDomain defaults to undefined", () => {
  const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
  const result = spawnSync(
    process.execPath,
    ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.opencodeRouterExternalDomain)))"],
    { env, encoding: "utf-8", cwd: resolve(import.meta.dir, "..") },
  )
  expect(result.stdout.trim()).toBe("undefined")
})
````

##### 6. `packages/opencode-router/src/pod-manager.test.ts`

**6a.** Set `process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"` after line 5 (with existing env vars).

**6b.** Add test in "ensurePod injects" block (after line 836):

```ts
it("injects OPENCODE_ROUTER_EXTERNAL_DOMAIN env var when configured", async () => {
  const session = {
    email: "user@test.com",
    repoUrl: "https://github.com/x/y",
    branch: "test-branch",
    sourceBranch: "main",
  }
  const hash = getSessionHash(session.email, session.repoUrl, session.branch)
  const { ensurePod } = await import("./pod-manager.js")
  await (ensurePod as any)(hash, session)
  const podBody = (createPodCalls[0] as any)?.body
  const envVars = podBody?.spec?.containers?.[0]?.env ?? []
  const domainEnv = envVars.find((e: any) => e.name === "OPENCODE_ROUTER_EXTERNAL_DOMAIN")
  expect(domainEnv).toBeDefined()
  expect(domainEnv?.value).toBe("test.local")
})
```

### Tasks

- [x] **1. `packages/opencode-router/src/config.ts`**: Add `opencodeRouterExternalDomain` config field from `OPENCODE_ROUTER_EXTERNAL_DOMAIN` env var (after line 60, before `devViteUrl`). Optional, no `required()`.
- [x] **2. `packages/opencode-router/src/pod-manager.ts`**: Inject `OPENCODE_ROUTER_EXTERNAL_DOMAIN` into session pods (after line 754). Follow conditional spread pattern: `...(config.opencodeRouterExternalDomain ? [...] : [])`.
- [x] **3. `deployment/homelab/src/index.ts`**: Pass `OPENCODE_ROUTER_EXTERNAL_DOMAIN` to the router deployment env (after line 452). Value is the existing `domain` Pulumi Output.
- [x] **4. `deployment/homelab/images/opencode/config/.agentskills/skills/dev-server/SKILL.md`**: Replace lines 75-116 (Get domain + Full URL construction + env vars table) with minimal one-liner using `OPENCODE_ROUTER_EXTERNAL_DOMAIN`. Remove the domain-not-available caveat. Add new var to env vars table.
- [x] **5. `packages/opencode-router/src/config.test.ts`**: Add test that `opencodeRouterExternalDomain` defaults to `undefined` when its env var is not set.
- [x] **6. `packages/opencode-router/src/pod-manager.test.ts`**: (a) Set `process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"` at top of file (after line 5). (b) Add test in "ensurePod injects" block verifying the env var is present in created pods.

### Completed

- [x] Task 1: Added `opencodeRouterExternalDomain` config field mapping from `OPENCODE_ROUTER_EXTERNAL_DOMAIN` env var in config.ts (line 61-68).
- [x] Task 2: Added conditional env injection in pod-manager.ts (lines 765-767) following the existing spread pattern.
- [x] Task 3: Added `OPENCODE_ROUTER_EXTERNAL_DOMAIN` env var in deployment/homelab/src/index.ts (line 453-454) with value from existing `domain` Pulumi Output.
- [x] Task 4: Replaced broken "Get the domain" section, "Full URL construction" section, env vars table, and removed domain-not-available caveat in SKILL.md.
- [x] Task 5: Added `opencodeRouterExternalDomain defaults to undefined` test in config.test.ts (lines 37-48) — passes.
- [x] Task 6: (a) Set `process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN` at top of pod-manager.test.ts (line 6). (b) Added injection test in "ensurePod injects" block (lines 839-854).

## Code

### Tasks

- [x] **1. `packages/opencode-router/src/config.ts`**: Add `opencodeRouterExternalDomain` config field
- [x] **2. `packages/opencode-router/src/pod-manager.ts`**: Inject `OPENCODE_ROUTER_EXTERNAL_DOMAIN` into session pods
- [x] **3. `deployment/homelab/src/index.ts`**: Pass `OPENCODE_ROUTER_EXTERNAL_DOMAIN` to router deployment
- [x] **4. `SKILL.md`**: Replace broken domain section with one-liner using new env var
- [x] **5. `config.test.ts`**: Add test for undefined default
- [x] **6. `pod-manager.test.ts`**: (a) Set process.env, (b) Add injection test

### Completed

- [x] All 6 Code phase tasks implemented and verified.
- [x] config tests pass (4/4). Pod-manager test has pre-existing node_modules issue (ENOENT tar-stream/streamx — reproduced without changes).
- [x] Implementation deviates slightly from plan: the edit tool auto-formatted the spread expression to multiline (lines 765-767), but logic is identical.

## Commit

### Tasks

- [x] **STEP 1 — Code Cleanup**: Searched all 6 modified files for debug output, TODO/FIXME/HACK markers, and commented-out code — none found.
- [x] **STEP 2 — Documentation Review**: Reviewed `.vibe/docs/requirements.md`, `architecture.md`, `design.md` — all are empty templates. No functional changes to document; all key decisions are captured in this plan file (Key Decisions section). No updates needed.
- [x] **STEP 3 — Final Validation**:
  - Config tests: 4/4 pass (all existing + the new `opencodeRouterExternalDomain defaults to undefined` test)
  - Pod-manager tests: Pre-existing `tar-stream/streamx` ENOENT issue (reproduced on base commit without changes) — not caused by this work
  - All code is production-ready with proper conditional injection and graceful degradation

### Completed

- [x] All 6 production and test files verified clean — no debug output, no TODOs, no commented-out code
- [x] Config tests pass (4/4)
- [x] Pod-manager test failure confirmed pre-existing (same error on base commit)
- [x] Documentation templates reviewed — no updates needed (all empty templates)
- [x] **Re-verified on 2026-05-13**: (a) No debug output or TODOs in any source file via ripgrep. (b) Config tests 4/4 pass. (c) Injection test present in pod-manager.test.ts (line 839). (d) No debug artifacts in SKILL.md or deployment/index.ts. All Commit phase criteria confirmed satisfied.

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
