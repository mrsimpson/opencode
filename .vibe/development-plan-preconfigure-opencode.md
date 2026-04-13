# Development Plan: opencode (preconfigure-opencode branch)

_Generated on 2026-04-13 by Vibe Feature MCP_
_Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)_

## Goal

Pre-configure the opencode instance launched by the **opencode-router** with plugins, API keys, model settings, MCP servers, and agent definitions — baking this configuration into the custom Docker image built from `./deployment/homelab/Makefile`.

The approach mirrors what was done in the homelab repo (commit `91405947`): pack a config directory into the image and let opencode discover it via its XDG config path resolution.

## Key Decisions

### KD-1: Config injection strategy — bake into image vs. Kubernetes ConfigMap

The homelab approach uses a Kubernetes ConfigMap + init container to restore a config directory tree into an emptyDir. For the opencode-router context, baking the config directly into a custom Docker image is simpler: no init container needed, no Kubernetes resources to manage.

The config is written to `/etc/opencode/` (Linux system-managed config path) which opencode reads with **highest** priority. This avoids touching the user home dir and survives PVC mounts.

### KD-2: API keys via environment variables (NOT baked in)

API keys (`ANTHROPIC_API_KEY`, etc.) must **not** be baked into the image. They are injected at runtime via Kubernetes Secrets → `envFrom: secretRef`. The `OPENCODE_CONFIG_CONTENT` env var or the system-level `opencode.json` can reference `{env:ANTHROPIC_API_KEY}` for the model/provider config, or the keys are simply present as env vars which opencode auto-detects.

### KD-3: opencode config resolution order (key insight)

opencode merges configs from multiple sources. Highest priority sources:

1. `OPENCODE_CONFIG_CONTENT` env var (inline JSON) ← great for runtime injection
2. System-managed files: Linux → `/etc/opencode/opencode.json{c}` ← great for image-baked config
3. Custom directory: `OPENCODE_CONFIG_DIR` env var
4. `~/.config/opencode/opencode.json` (global, via XDG)
5. Project-level `opencode.json` (workspace root)

**Decision**: Bake config into `/etc/opencode/opencode.json` inside the image. This makes it "system defaults" that any per-session or per-project config can still override.

### KD-4: What to bake vs. what to inject at runtime

**Bake into image** (stable, non-secret):

- MCP server definitions (workflows, knowledge, agentskills, etc.)
- Default model settings (but not API keys)
- Agent definitions (`.opencode/agents/*.md` files)
- Plugin configuration
- Permission defaults

**Inject at runtime** (secrets / environment-specific):

- API keys (`ANTHROPIC_API_KEY`, etc.) via Kubernetes Secret → `envFrom`
- Model override (in case the deployment wants a specific model)

### KD-5: Config approach — use standard home dir (XDG default), seed PVC on first start

**Question asked**: Would it be simpler to use the home dir (`Global.Path.config` = `~/.config/opencode`) for all config rather than a custom `XDG_CONFIG_HOME` or `OPENCODE_CONFIG_DIR`?

**Answer: Yes — this is the simplest correct approach**, given that:

- The homelab opencode image already sets `USER opencode` and `HOME=/home/opencode`
- The pod mounts the PVC directly at `/home/opencode` (the user's home dir)
- `Global.Path.config` = `$XDG_CONFIG_HOME/opencode` = `~/.config/opencode` = `/home/opencode/.config/opencode` — which lives **on the PVC**

**Why not bake config into `/home/opencode/.config/opencode/` in the image layer?**

The PVC is mounted at `/home/opencode` — the mount **hides the image layer** at that path entirely. Files COPY'd to `/home/opencode/...` in the Dockerfile are unreachable at runtime. The init container is therefore still needed, but it seeds the **PVC itself** (which persists across pod restarts).

**Why not `XDG_CONFIG_HOME` pointing to a separate emptyDir (previous plan)?**

It works, but it's more complex than necessary: an extra env var, an extra volume, and the config is reset on every pod restart (emptyDir is ephemeral). The PVC is already there and persistent — use it.

**Why not `OPENCODE_CONFIG_DIR=/etc/opencode-defaults` (read-only, no init container)?**

`installDependencies()` in config.ts is guarded by `isWritable()` and returns early for read-only dirs — so read-only is technically safe. However, it means users cannot edit agents or add plugins at runtime (everything is frozen in the image). For flexibility it's inferior.

**Chosen approach: image-baked defaults → init container → PVC-backed `~/.config/opencode/`**

1. Custom Docker image bakes all config under `/etc/opencode-defaults/`:
   - `opencode.json` — MCP servers, model, providers, permissions
   - `agents/*.md` — agent definitions
   - `commands/*.md` — slash commands
2. The **`config-init` init container** (reusing the same image) checks if `/home/opencode/.config/opencode` already exists on the PVC; if not, it copies from `/etc/opencode-defaults/`. This is idempotent — subsequent pod restarts skip the copy.
3. No `XDG_CONFIG_HOME` env var needed. `HOME=/home/opencode` (already set in the image) → `Global.Path.config = /home/opencode/.config/opencode` — writable, on the PVC, discovered automatically.

**Priority order in the running pod (lowest → highest):**

1. Project `opencode.json` in workspace
2. `.opencode/` dirs in workspace and `$HOME`
3. **`/home/opencode/.config/opencode/` (XDG global — image defaults, seeded on first start)**
4. K8s ConfigMap at `/home/opencode/.opencode/` (operator override, read-only mount)
5. `OPENCODE_CONFIG_CONTENT` env var (runtime override)
6. `/etc/opencode/opencode.json` (system-managed — highest, for hard operator overrides)

**For forks**: edit files under `deployment/homelab/images/opencode/config/`. One directory, all config types (opencode.json + agents/ + commands/). Rebuild the image. On next fresh session pod, the PVC is empty and the init container seeds the new defaults.

**KD-5b: Init container idempotency**

```sh
if [ ! -d /home/opencode/.config/opencode ]; then
  cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/
fi
```

- **First pod start** (new session, empty PVC): directory doesn't exist → copy runs
- **Pod restart** (same session, PVC still has data): directory exists → copy skipped, user's modifications preserved
- **Image update** (fork updates config): new sessions get new defaults; existing sessions keep their PVC copy (intentional — users may have customised)

**KD-5c: Three options considered**

| Option                            | Init container needed | `XDG_CONFIG_HOME` env var | Config persists across restarts | User can edit config at runtime |
| --------------------------------- | --------------------- | ------------------------- | ------------------------------- | ------------------------------- |
| A. emptyDir + `XDG_CONFIG_HOME`   | Yes                   | Yes                       | No (emptyDir)                   | No                              |
| **B. PVC home dir (chosen)**      | **Yes (idempotent)**  | **No**                    | **Yes (PVC)**                   | **Yes**                         |
| C. `OPENCODE_CONFIG_DIR=/etc/...` | No                    | No                        | N/A (read-only)                 | No                              |

### KD-6: Config content — reference from homelab commit 91405947 with plugin substitutions

Based on `packages/apps/opencode/config/` from homelab commit `91405947`:

**Plugins** (replaces the `workflows` MCP server from the reference):

```json
"plugin": [
  "@ex-machina/opencode-anthropic-auth@1.5.1",
  "@codemcp/workflows-opencode@6.11.1"
]
```

- `@ex-machina/opencode-anthropic-auth` — Anthropic OAuth auth so Claude Pro/Max users can use their subscription
- `@codemcp/workflows-opencode` — structured development workflow plugin (replaces `@codemcp/workflows-server` MCP)

**MCP servers kept** (from `.mcp.json` in homelab commit):

- `knowledge` → `@codemcp/knowledge-server` (npx)
- `agentskills` → `@codemcp/skills-server` (npx)
- `workflows` MCP server **removed** (replaced by plugin above)

**Agent** (from `.opencode/agents/ade.md`): the ADE agent definition with full permission policy

**Skills** (from `.agentskills/skills/` and `.ade/skills/`):

- `conventional-commits` skill
- `adr-nygard` skill

**Image base**: `ghcr.io/anomalyco/opencode` (upstream, no tag pin — homelab variant adds tools on top)

**Dockerfile tools** (from `images/opencode/Dockerfile` in homelab commit):

- `git, curl, bash, nodejs, npm, pnpm, python3` via apk
- `gh` CLI (GitHub CLI)
- `bd` (beads task manager)
- Non-root user `opencode` (UID 1000), `HOME=/home/opencode`

### KD-7: Current opencode-router ConfigMap approach

The current `pod-manager.ts` already mounts a ConfigMap at `/home/opencode/.opencode` (line 249):

```ts
{ name: "opencode-config", mountPath: "/home/opencode/.opencode", readOnly: true }
```

The ConfigMap (`opencode-config-dir`) contains `opencode.json` with the current model. This is the injection point. We can either:

- **Extend the ConfigMap** with more files (agents, MCP config)
- **Bake into image** (simpler, no K8s resource changes needed for config updates)

Both can coexist. The image provides system defaults; the ConfigMap overrides specific fields.

### KD-9: Generic env injection via `.env` file in ConfigMap (replaces KD-8)

Rather than adding named env var pass-throughs to the router (e.g. `workflowAgents`), the operator populates a `.env` file inside the **existing ConfigMap** (`opencode-config-dir`) which is already mounted at `/home/opencode/.opencode/`.

The opencode container entrypoint sources it before exec'ing the server:

```sh
set -a; . /home/opencode/.opencode/.env 2>/dev/null || true; set +a; exec opencode serve ...
```

**Pulumi side**: `cfg.get("podEnv")` reads an optional multiline string from `code:podEnv` config key. Example:

```yaml
code:podEnv: |
  WORKFLOW_AGENTS=ade
  OPENCODE_MODEL=anthropic/claude-opus-4
```

**Benefits over named pass-throughs**:

- Zero router code changes needed for new vars
- Standard `.env` syntax, operator-friendly
- ConfigMap already mounted — no new volumes or secrets
- Works for any current or future env var opencode supports

**`workflowAgents` Pulumi config key and `config.workflowAgents` removed** — subsumed by this generic mechanism.

### KD-12: Merged init containers — single `init` container using the opencode image

The original design used two sequential init containers (`config-init` + `git-init`). Each container start costs ~1–3s of K8s scheduling overhead, so two containers meant paying that cost twice.

**Decision: merge into a single `init` container** using the custom opencode image (which already has `git` via `apk add`). The merged script runs config seeding first, then the git clone/checkout:

```sh
set -e
# --- config phase (idempotent) ---
if [ ! -d /home/opencode/.config/opencode ]; then
  mkdir -p /home/opencode/.config/opencode
  cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/
  for s in /etc/opencode-defaults/init-scripts/*.sh; do
    [ -f "$s" ] && sh "$s" || true
  done
fi
# --- git phase ---
GIT="git -c safe.directory=/workspace"
if [ ! -d /workspace/.git ]; then
  git clone "<repoUrl>" /workspace
fi
...
```

**Why merging into the opencode image (not alpine/git) is the right direction:**

- The opencode image is already pulled for the main container — no extra pull cost
- `alpine/git` does not have `/etc/opencode-defaults/`, so config seeding cannot move there
- Single init container = one scheduling event instead of two
- `HOME` writable concern goes away: `HOME=/home/opencode` on the PVC is available to the merged script, and `safe.directory` still bypasses the global git config write

**Volume mounts on the merged container:**

- `/home/opencode` ← full PVC (for config seeding + HOME)
- `/workspace` ← PVC subPath `projects` (for git clone)

### KD-11: Init scripts — part of config tree, run by config-init after seeding

Init scripts live under `config/init-scripts/*.sh` — baked into `/etc/opencode-defaults/init-scripts/` via the existing `COPY config/ /etc/opencode-defaults/` Dockerfile instruction. They are **not** hardcoded into the Dockerfile itself.

The `config-init` container runs them **once**, after seeding the config directory on first pod start:

```sh
if [ ! -d /home/opencode/.config/opencode ]; then
  mkdir -p /home/opencode/.config/opencode
  cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/
  for s in /etc/opencode-defaults/init-scripts/*.sh; do
    [ -f "$s" ] && sh "$s" || true
  done
fi
```

- Scripts are skipped on pod restart (guarded by the same `if [ ! -d ... ]` check)
- Scripts run with `HOME=/home/opencode` pointing at the PVC — needed for tools that write to `~`
- `|| true` ensures a failing script doesn't block pod startup
- Adding new init behavior = add a `.sh` file under `config/init-scripts/`, rebuild image

**Default script**: `config/init-scripts/post-init.sh` runs `npx -y @codemcp/skills install` to register baked-in skills with `@codemcp/skills-server`.

### KD-10: MCP packages pre-installed globally — `npx -y` config unchanged

`@codemcp/skills-server` fails at pod start because its dist bundle imports `gray-matter`, `ajv`, and `zod` as bare specifiers that must resolve from `node_modules`. Unlike `@codemcp/knowledge-server` (which only needs Node built-ins + MCP SDK), `skills-server` ships with `pacote@21.3.1` as a runtime dep — a heavy subtree that makes `npx` installs slow and unreliable in restricted pod environments.

**Fix**: `npm install -g` both MCP packages in the Dockerfile, run as root during image build. Globally installed packages are found by `npx` before it tries the registry, so **`opencode.json` stays unchanged** with `["npx", "-y", "@codemcp/skills-server"]`.

**Self-documenting Dockerfile**: rather than hardcoding package names, a `node -e` inline script reads `opencode.json` at build time and installs every `npx`-referenced MCP command globally. Adding a new MCP server to `opencode.json` automatically gets it pre-installed — no Dockerfile edit needed.

**Layer ordering**: `COPY config/` happens before the `npm install -g` RUN step so the inline script can parse `opencode.json`. The config copy is root-owned (no `--chown`) since `/etc/opencode-defaults/` is intentionally read-only.

## Notes

### opencode Configuration System (as-explored)

**`Global.Path.config`** = `$XDG_CONFIG_HOME/opencode` (default: `~/.config/opencode`)

The `ConfigPaths.directories()` function returns, in order:

1. `Global.Path.config` — always included; agents/commands/plugins are scanned here
2. `.opencode/` dirs walked up from the workspace root
3. `.opencode/` in `$HOME`
4. `OPENCODE_CONFIG_DIR` env var if set (also triggers `opencode.json` read inside it)

The main `opencode.json` at `Global.Path.config` is loaded via `loadGlobal()` (separate from the directory scan). **All** directories in the list also get `loadAgent()`, `loadCommand()`, `loadPlugin()` called on them — scanning for markdown files in `agents/`, `commands/`, `plugins/` subdirs.

**Critical constraint**: `global/index.ts` calls `fs.mkdir(Global.Path.config, { recursive: true })` at startup → the path must be writable, so `/etc/opencode` cannot be used directly as `XDG_CONFIG_HOME`.

**Config priority order (lowest → highest)**:

1. Well-known remote fetch
2. `~/.config/opencode/opencode.json` (XDG global)
3. `.opencode/` dirs in project + home
4. `OPENCODE_CONFIG_DIR` env var
5. `OPENCODE_CONFIG_CONTENT` env var
6. Console/account remote config
7. System-managed: `/etc/opencode/opencode.json{c}` (read-only override)
8. macOS MDM (not relevant)

### Implementation Strategy

**Chosen design: image-baked defaults → idempotent init container → PVC-backed `~/.config/opencode/`**

The homelab opencode image already has `USER opencode` / `HOME=/home/opencode`. The pod PVC mounts at `/home/opencode`. So `Global.Path.config` = `/home/opencode/.config/opencode` — **already on the PVC, writable, no extra env vars needed**.

```
Docker image
  └── /etc/opencode-defaults/          ← read-only, baked at build time
        ├── opencode.json              ← MCP servers, model, providers, permissions
        ├── agents/
        │     └── researcher.md        ← example — forks add their own here
        └── commands/
              └── review.md

Session pod spec
  initContainers:
    - name: config-init
      image: <custom opencode image>   ← same image, reuses /etc/opencode-defaults
      command: ["sh", "-c"]
      args:
        - |
          if [ ! -d /home/opencode/.config/opencode ]; then
            mkdir -p /home/opencode/.config/opencode
            cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/
          fi
      volumeMounts:
        - name: user-data
          mountPath: /home/opencode
  containers:
    - name: opencode
      # No XDG_CONFIG_HOME needed — HOME=/home/opencode already set in image
      volumeMounts:
        - name: user-data               ← PVC → /home/opencode (includes .config/opencode)
          mountPath: /home/opencode
        - name: opencode-config         ← K8s ConfigMap override (higher priority)
          mountPath: /home/opencode/.opencode
          readOnly: true
```

**No extra env var needed.** `HOME=/home/opencode` is baked into the image → `Global.Path.config = /home/opencode/.config/opencode` is discovered automatically by opencode.

**Persistence**: config lives on the PVC — survives pod restarts. On new sessions (fresh PVC) the init container seeds the defaults once.

**For forks**: edit `deployment/homelab/images/opencode/config/`. One directory, all config. Rebuild image. New sessions get new defaults; existing sessions keep their PVC copy.

### Files to Create / Change

| File                                                      | Action     | Purpose                                                                                |
| --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `deployment/homelab/images/opencode/Dockerfile`           | **Create** | Extends upstream, COPYs config to `/etc/opencode-defaults/`                            |
| `deployment/homelab/images/opencode/config/opencode.json` | **Create** | Default MCP/model config                                                               |
| `deployment/homelab/images/opencode/config/agents/*.md`   | **Create** | Example agent definitions                                                              |
| `deployment/homelab/Makefile`                             | **Extend** | `build-opencode` / `push-opencode` targets                                             |
| `packages/opencode-router/src/pod-manager.ts`             | **Extend** | Add `config-init` initContainer (idempotent seed); **no** emptyDir, **no** XDG env var |
| `deployment/homelab/src/index.ts`                         | **Verify** | `opencodeImage` Pulumi config var already present                                      |
| `deployment/homelab/Pulumi.dev.yaml`                      | **Extend** | Set `code:opencodeImage` to new custom tag                                             |

## Explore

<!-- beads-phase-id: opencode-2.1 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Plan

<!-- beads-phase-id: opencode-2.2 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Code

<!-- beads-phase-id: opencode-2.3 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Commit

<!-- beads-phase-id: opencode-2.4 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
