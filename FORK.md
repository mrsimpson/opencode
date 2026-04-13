# Fork Guide: mrsimpson/opencode

This is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) extended with infrastructure components for self-hosted, multi-user homelab deployments.

## Fork-specific packages

| Package                                                         | Location                                   | Purpose                                                                     |
| --------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| [opencode-router](packages/opencode-router/README.md)           | `packages/opencode-router/`                | HTTP/WebSocket reverse proxy providing per-user pod isolation on Kubernetes |
| [opencode-router-app](packages/opencode-router-app/)            | `packages/opencode-router-app/`            | SolidJS SPA for managing sessions (start, resume, terminate)                |
| [homelab deployment](deployment/homelab/)                       | `deployment/homelab/`                      | Pulumi stack deploying the full stack to a k3s cluster                      |
| [cloudflare operator](deployment/opencode-cloudflare-operator/) | `deployment/opencode-cloudflare-operator/` | Kubernetes operator for per-session Cloudflare DNS                          |

## Branch strategy

| Branch | Purpose                                                               |
| ------ | --------------------------------------------------------------------- |
| `main` | Fork integration branch — all fork PRs target this                    |
| `dev`  | Local tracking ref for `upstream/dev` — do not push fork changes here |

```bash
# Set up git remotes after cloning
git remote add upstream https://github.com/sst/opencode.git
git fetch upstream
```

## CI/CD

Fork CI is handled by explicit fork-owned workflows:

| Workflow                        | Trigger                       | What it does                                                                                        |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `fork-validate.yml`             | PR → `main`, push to `main`   | Typecheck + test `opencode-router` and `opencode-router-app`; blocks on upstream file modifications |
| `build-opencode-router.yml`     | Push to `main` (paths filter) | Builds and pushes `opencode-router` Docker image to GHCR                                            |
| `build-cloudflare-operator.yml` | Push to `main` (paths filter) | Builds and pushes `opencode-cloudflare-operator` Docker image to GHCR                               |
| `deploy-homelab.yml`            | After successful image build  | Deploys to homelab k3s cluster via Pulumi                                                           |

Upstream workflows that are irrelevant to the fork are disabled server-side via:

```bash
bash .github/fork/disable-upstream-workflows.sh
```

Re-run this script after every upstream merge to catch newly added upstream workflows.

## Merging upstream

```bash
# Fetch latest upstream
git fetch upstream

# Merge into your local dev tracking branch
git checkout dev
git merge upstream/dev

# Rebase or merge fork main onto updated dev
git checkout main
git merge dev          # or: git rebase dev
```

If the merge produces conflicts in upstream-owned files (`packages/opencode/`, `packages/app/`, etc.), resolve by keeping the upstream version. Fork changes should only exist in fork-owned paths.

**Fork-owned paths (never conflict with upstream):**

- `packages/opencode-router/`
- `packages/opencode-router-app/`
- `deployment/`
- `.github/workflows/build-*.yml`
- `.github/workflows/deploy-homelab.yml`
- `.github/workflows/fork-validate.yml`
- `.github/fork/`
- `FORK.md`

## Compatibility guard

The `fork-validate.yml` CI workflow includes a `compatibility-guard` job that **fails** if any upstream-owned files are modified in a PR. This prevents accidental upstream file pollution. If a modification is intentional (e.g. reverting AI-injected noise), document the reason clearly in the PR description — but be aware the guard will still fail and require a bypass.

## Local development

```bash
# Install all dependencies (Bun workspace)
bun install

# opencode-router (uses pnpm — separate lockfile)
cd packages/opencode-router
pnpm install
pnpm dev

# opencode-router-app
cd packages/opencode-router-app
bun dev

# Homelab deployment (uses npm)
cd deployment/homelab
npm install
```

See each package's own README for detailed setup instructions.
