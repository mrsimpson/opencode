# Development Plan: opencode (make-fork-independent branch)

_Generated on 2026-04-13 by Vibe Feature MCP_
_Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)_

## Goal

Optimize this fork of `sst/opencode` (now `anomalyco/opencode`) so that:

1. Fork-specific extensions remain **non-destructive** and **additive only**
2. Upstream merges stay easy (minimal diff surface, no upstream file pollution)
3. Developer experience (DX) is smooth for contributors working on the fork

## Key Decisions

### Separation Strategy

- Fork-specific packages (`opencode-router`, `opencode-router-app`) remain in their own directories — **no changes to upstream packages**
- `deployment/` stays outside Bun workspace deliberately (uses npm/Node.js to avoid Bun catalog: incompatibility with Pulumi)
- Fork-specific CI workflows are additive files in `.github/workflows/` — never modify upstream workflow files

### What NOT to do

- Do not touch `packages/opencode/`, `packages/app/`, `packages/ui/`, `packages/sdk/js/`, `packages/desktop/`, or any other upstream packages
- Do not modify root `package.json` beyond what's strictly needed (e.g. adding fork packages to workspaces)
- Do not add fork-specific config to files shared with upstream (e.g. `turbo.json`, `tsconfig.json`, `bunfig.toml`)
- Do not modify `AGENTS.md` (upstream file; fork contributors can rely on fork-specific docs instead)

### Noise to clean up

- `packages/opencode/package.json` has AI-agent artifacts: `"randomField"`, placeholder scripts (`random`, `clean`, `lint`, `format`, `docs`, `deploy`) — these must be reverted/removed
- These are the **only changes to upstream files** needed

### Disabling upstream workflows — DRY via `gh workflow disable`

**Decision:** Use `gh workflow disable <name> --repo mrsimpson/opencode` for each unwanted workflow. **No files are touched.**

- State stored server-side by GitHub; zero merge conflict risk on upstream merges
- Self-documenting: a script `.github/fork/disable-upstream-workflows.sh` lists every disabled workflow with a comment explaining why
- After every upstream merge, re-run the script to catch any newly added noisy workflows
- To re-enable a workflow: `gh workflow enable <name>`

**Workflows to keep enabled (fork-relevant or harmless):**

- `build-opencode-router.yml`, `build-cloudflare-operator.yml`, `deploy-homelab.yml` — fork-owned, should run
- `pr-standards.yml` — useful conventional commit enforcement, keep
- `publish.yml`, `stats.yml`, `docs-update.yml` — already guarded by `if: repo == upstream`, harmless

**Workflows to disable (all others):** see `.github/fork/disable-upstream-workflows.sh`

### Documentation strategy

- Do **not** update `AGENTS.md` (upstream file — skip entirely)
- Add a **"Fork extensions"** section at the very top of `README.md` (above the upstream logo/badges block) with a brief description and links to each fork package
- Create `FORK.md` as the canonical contributor guide for the fork: upstream merge procedure, fork packages, branch strategy, CI management
- Fork-specific scripts go in `.github/fork/` (new directory, never conflicts with upstream)

### README strategy

- `README.md` is upstream but we prepend a small fork-specific section at the top
- This section survives merges if kept minimal (upstream adds to the file's interior; a top-of-file prepend rarely conflicts)
- Section links to `FORK.md` and each fork package's own README

## Notes

### Repo context

- **Upstream:** `https://github.com/sst/opencode` (redirects to `anomalyco/opencode`)
- **Fork:** `https://github.com/mrsimpson/opencode`
- **Default branch:** `dev` (tracks upstream `dev`)
- **Working branch:** `make-fork-independent`
- **Commits ahead of upstream/dev:** 11 commits, all additive except the noisy `packages/opencode/package.json`

### Fork-specific components

| Component           | Location                                           | Purpose                                     |
| ------------------- | -------------------------------------------------- | ------------------------------------------- |
| opencode-router     | `packages/opencode-router/`                        | K8s per-user pod isolation HTTP/WS proxy    |
| opencode-router-app | `packages/opencode-router-app/`                    | SolidJS session management SPA              |
| homelab deployment  | `deployment/homelab/`                              | Pulumi stack for k3s cluster                |
| cloudflare operator | `deployment/opencode-cloudflare-operator/`         | K8s operator for per-session Cloudflare DNS |
| fork CI             | `.github/workflows/build-opencode-router.yml` etc. | GHCR image builds + homelab deploy          |

### DX improvements identified

- Add a `FORK.md` clearly documenting fork structure, upstream merge procedure, and fork-specific packages for contributors
- Ensure `upstream` git remote is documented
- Add fork-specific packages to a clearly labelled section in root `package.json` workspaces
- Consider a `fork-check` CI step that warns if upstream files were accidentally modified

### Branch Strategy

The user wants to rename the fork's default branch from `dev` to `main`. This cleanly separates fork identity from upstream tracking.

**Current state:**

- Fork default: `dev` (same name as upstream) — causes confusion
- `upstream/dev` = upstream integration branch
- Goal: `main` = fork integration branch, `dev` kept only as local tracking ref for upstream

**What references `dev` and must be updated (fork-owned files only):**

| File                                              | Reference                                                                                | Notes                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `AGENTS.md`                                       | `The default branch in this repo is \`dev\``and`use \`dev\` or \`origin/dev\` for diffs` | Must update to `main`                                                       |
| `.github/workflows/build-opencode-router.yml`     | `branches: - dev`                                                                        | Fork-owned → update to `main`                                               |
| `.github/workflows/build-cloudflare-operator.yml` | `branches: - dev`                                                                        | Fork-owned → update to `main`                                               |
| `.github/workflows/deploy-homelab.yml`            | `branches: - dev`, `pulumi-stack: mrsimpson/opencode/dev`                                | Fork-owned → update branch to `main`; Pulumi stack name is separate concern |

**Upstream workflow files referencing `dev` (do NOT change — will conflict on merge):**

| File                        | Reference                                                       | Strategy                                             |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `test.yml`                  | `branches: - dev`, concurrency group check for `refs/heads/dev` | Leave as-is (will be disabled via repo guard anyway) |
| `typecheck.yml`             | `branches: [dev]`                                               | Leave as-is                                          |
| `nix-eval.yml`              | `branches: [dev]`                                               | Leave as-is                                          |
| `nix-hashes.yml`            | `branches: [dev, beta]`                                         | Leave as-is                                          |
| `storybook.yml`             | `branches: [dev]`                                               | Leave as-is                                          |
| `generate.yml`              | `branches: - dev` (push trigger)                                | Leave as-is                                          |
| `containers.yml`            | `branches: - dev`                                               | Leave as-is                                          |
| `deploy.yml`                | `branches: - dev`                                               | Leave as-is                                          |
| `release-github-action.yml` | `branches: - dev`                                               | Leave as-is                                          |
| `publish.yml`               | `branches: - dev`                                               | Leave as-is (already guarded)                        |
| `docs-locale-sync.yml`      | `branches: - dev`                                               | Leave as-is (already disabled)                       |
| `pr-standards.yml`          | `ref: 'dev'`                                                    | Leave as-is                                          |

**Pulumi stack name:** The Pulumi stack `mrsimpson/opencode/dev` is a Pulumi Cloud concept (org/project/stack), separate from the git branch name. Renaming the git branch does not require renaming the Pulumi stack — but `deploy-homelab.yml` references it; leave Pulumi stack name as `dev` for now (it's a cloud resource, renaming is a separate operation).

**Git operations needed:**

1. Rename local `dev` → `main`
2. Push `main` to origin
3. Set `origin/HEAD` → `main`
4. Update GitHub default branch setting (via `gh` CLI or UI)
5. Keep `dev` as a local-only tracking branch for `upstream/dev`

### CI Strategy (Revised: Explicit over Negative)

**Key decision:** Rather than primarily disabling upstream workflows, we define **explicit fork CI** that covers everything the fork needs. This is additive, positive, and clear to contributors.

**Fork CI coverage:**

| Need                                        | Workflow                        | Trigger                          |
| ------------------------------------------- | ------------------------------- | -------------------------------- |
| Validate PR changes to fork packages        | `fork-validate.yml`             | `pull_request`, `push` to `main` |
| Build + publish `opencode-router` image     | `build-opencode-router.yml`     | push to `main` (paths filter)    |
| Build + publish `cloudflare-operator` image | `build-cloudflare-operator.yml` | push to `main` (paths filter)    |
| Deploy to homelab                           | `deploy-homelab.yml`            | `workflow_run` after image build |

**`fork-validate.yml` jobs:**

1. `validate-router` — install pnpm deps, typecheck (`tsc --noEmit`), run tests (`bun test`)
2. `validate-router-app` — install bun deps from **repo root** (so workspace deps like `@opencode-ai/ui` resolve), typecheck + test + build in package dir
3. `compatibility-guard` — detect if any upstream package files were modified vs PR base branch; post a warning comment on PR if so

**Design notes:**

- `opencode-router` uses pnpm (has its own `pnpm-lock.yaml`); installed in package dir
- `opencode-router-app` uses bun and has workspace deps → `bun install` must run at repo root
- Compatibility guard is a **blocking failure** (`core.setFailed`): upstream file modifications must not land in `main`; posts a PR comment with the violated files

**Disabling upstream workflows (secondary):** still useful to reduce noise and wasted CI minutes on the fork. The disable script in `.github/fork/disable-upstream-workflows.sh` documents what was disabled and why.

### CI/CD Analysis

**35 upstream workflows** are inherited — the vast majority are irrelevant or even harmful for this fork:

| Workflow                    | Status                                                                                           | Reason                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `publish.yml`               | Already guarded — `if: github.repository == 'anomalyco/opencode'` on all jobs                    | Will never run on fork                                                                      |
| `stats.yml`                 | Already guarded — `if: github.repository == 'anomalyco/opencode'`                                | Will never run on fork                                                                      |
| `docs-update.yml`           | Already guarded — `if: github.repository == 'sst/opencode'`                                      | Will never run on fork                                                                      |
| `test.yml`                  | **RUNS on fork** — tests `packages/opencode` and `packages/app` (upstream code) on every PR/push | Unnecessary for fork; wastes CI minutes; uses expensive Blacksmith runners + Windows matrix |
| `typecheck.yml`             | **RUNS on fork** — typechecks all packages including upstream ones                               | Partly useful but runs on upstream code we don't change                                     |
| `nix-eval.yml`              | **RUNS on fork**                                                                                 | No Nix changes expected in fork                                                             |
| `nix-hashes.yml`            | **RUNS on fork**                                                                                 | No Nix changes expected in fork                                                             |
| `beta.yml`                  | **RUNS on fork** (schedule + dispatch) — tries to sync beta branch                               | Meaningless for fork                                                                        |
| `generate.yml`              | **RUNS on fork** (push to dev) — regenerates SDK, creates PRs                                    | Will create unwanted automated PRs                                                          |
| `containers.yml`            | **RUNS on fork** (push to dev) — builds upstream container images                                | Wastes CI time                                                                              |
| `storybook.yml`             | **RUNS on fork**                                                                                 | Storybook not used by fork                                                                  |
| `triage.yml`                | **RUNS on fork** — AI issue triage                                                               | Adds noise to fork's issues                                                                 |
| `duplicate-issues.yml`      | **RUNS on fork**                                                                                 | Adds noise                                                                                  |
| `review.yml`                | **RUNS on fork**                                                                                 | Upstream review bot, not appropriate                                                        |
| `opencode.yml`              | **RUNS on fork** — `/oc` slash commands using opencode AI bot                                    | Bot tokens not available in fork                                                            |
| `pr-management.yml`         | **RUNS on fork**                                                                                 | Upstream team-membership checks will fail                                                   |
| `pr-standards.yml`          | **RUNS on fork** — conventional commit check                                                     | Could keep this                                                                             |
| `close-issues.yml`          | **RUNS on fork** (daily schedule)                                                                | Irrelevant                                                                                  |
| `close-stale-prs.yml`       | **RUNS on fork** (daily schedule)                                                                | Irrelevant                                                                                  |
| `compliance-close.yml`      | **RUNS on fork** (every 30 min schedule!)                                                        | Very noisy, irrelevant                                                                      |
| `daily-issues-recap.yml`    | **RUNS on fork** (daily schedule)                                                                | Irrelevant                                                                                  |
| `daily-pr-recap.yml`        | **RUNS on fork** (daily schedule)                                                                | Irrelevant                                                                                  |
| `docs-locale-sync.yml`      | Disabled — `if: false` in job                                                                    | Not running                                                                                 |
| `notify-discord.yml`        | Trigger on release only                                                                          | Not applicable to fork                                                                      |
| `deploy.yml`                | **RUNS on fork** (push to dev) — SST/AWS deploy                                                  | Dangerous: will try to deploy upstream cloud infra                                          |
| `vouch-check-pr.yml`        | **RUNS on fork** — denounced author checks                                                       | Useless for fork                                                                            |
| `vouch-check-issue.yml`     | **RUNS on fork**                                                                                 | Useless                                                                                     |
| `vouch-manage-by-issue.yml` | **RUNS on fork**                                                                                 | Useless                                                                                     |
| `release-github-action.yml` | **RUNS on fork** (push to dev, paths: `github/**`)                                               | Irrelevant                                                                                  |
| `sync-zed-extension.yml`    | Trigger on release only                                                                          | Not applicable                                                                              |
| `publish-github-action.yml` | Trigger on tags only                                                                             | Not applicable                                                                              |
| `publish-vscode.yml`        | Trigger on tags only                                                                             | Not applicable                                                                              |

**Fork-specific workflows (already exist):**

- `build-opencode-router.yml` ✅ — good
- `build-cloudflare-operator.yml` ✅ — good
- `deploy-homelab.yml` ✅ — good

**Problem:** `opencode-router` has its own `pnpm-lock.yaml` and uses Node.js (not Bun), so it's outside the Bun workspace. Its tests run via `bun test` but the package is NOT included in `turbo.json` tasks. The `opencode-router-app` IS in the Bun workspace (`packages/*` glob) and has `test` and `typecheck` scripts, but turbo doesn't know about it.

**Disabling strategy — DRY, zero file changes:**

Use `gh workflow disable <name> --repo mrsimpson/opencode` for each unwanted upstream workflow. This is:

- **DRY**: state stored server-side by GitHub, no file changes needed
- **Zero merge conflict risk**: upstream files are never touched
- **Reversible**: `gh workflow enable` re-activates any workflow
- **Documented**: a shell script in the fork docs captures which workflows are disabled and why

When upstream merges bring in new workflows, they start as "active" — the same script is re-run to catch any newly added noisy workflows. The script lives in `.github/fork/` (fork-owned, never conflicts with upstream).

## Explore

<!-- beads-phase-id: opencode-3.1 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Plan

<!-- beads-phase-id: opencode-3.2 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Code

<!-- beads-phase-id: opencode-3.3 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Commit

<!-- beads-phase-id: opencode-3.4 -->

### Tasks

<!-- beads-synced: 2026-04-13 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
