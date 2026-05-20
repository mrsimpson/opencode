---
name: create-pr
description: Use when creating a pull request in this repository (mrsimpson/opencode fork of anomalyco/opencode). Ensures PRs always target the correct base branch and remote — fork feature branches must target origin/main, never origin/dev or upstream.
---

# Creating Pull Requests in this Repository

This is a **fork** of `anomalyco/opencode`. The remotes and branches have specific roles:

| Remote | Repo | Role |
|--------|------|------|
| `origin` | `mrsimpson/opencode` | The fork — where all fork work lives |
| `upstream` | `anomalyco/opencode` | The upstream project — read-only for this fork |

| Branch | Purpose |
|--------|---------|
| `main` | Fork integration branch — **all fork PRs target this** |
| `dev` | Tracks `upstream/dev` — **never target this with fork PRs** |

## Mandatory pre-PR checklist

1. **Identify the remote** — run `git remote -v` to confirm `origin` points to `mrsimpson/opencode`.
2. **Push to `origin`** — always push the feature branch to `origin`, never to `upstream` (you likely don't have push access anyway).
   ```bash
   git push -u origin <branch>
   ```
3. **Target `origin/main`** — always pass `--repo mrsimpson/opencode --base main` to `gh pr create`.
   ```bash
   gh pr create --repo mrsimpson/opencode --base main --title "..." --body "..."
   ```
4. **Never use `--base dev`** — `dev` is the upstream tracking branch; PRs against it will be merged into the wrong place.
5. **Never open PRs against `upstream`** — you don't own that repo; PRs created via `gh pr create` without `--repo` will default to the repo `gh` infers from the first listed remote, which may be `upstream`.

## Common mistake to avoid

Running `gh pr create` without `--repo` or `--base` can silently create the PR against the wrong repo or branch. **Always be explicit:**

```bash
# ✅ Correct
gh pr create --repo mrsimpson/opencode --base main --title "feat: ..." --body "..."

# ❌ Wrong — omitting --repo lets gh pick the upstream
gh pr create --base main --title "feat: ..." --body "..."

# ❌ Wrong — dev tracks upstream, not fork integration
gh pr create --repo mrsimpson/opencode --base dev --title "feat: ..." --body "..."
```

## Full workflow

```bash
# 1. Ensure work is committed
git status

# 2. Push feature branch to the fork
git push -u origin <your-branch>

# 3. Open PR against fork main
gh pr create \
  --repo mrsimpson/opencode \
  --base main \
  --title "feat(...): ..." \
  --body "$(cat <<'EOF'
## Summary
- bullet 1
- bullet 2
EOF
)"
```

## Fork-owned paths (safe to modify in PRs)

Only modify files under these paths — the CI `compatibility-guard` will **fail** any PR that touches upstream-owned files:

- `packages/opencode-router/`
- `packages/opencode-router-app/`
- `deployment/`
- `.github/workflows/build-*.yml`
- `.github/workflows/deploy-homelab.yml`
- `.github/workflows/fork-validate.yml`
- `.github/fork/`
- `FORK.md`
- `.opencode/` (this directory)
