#!/usr/bin/env bash
# .github/fork/disable-upstream-workflows.sh
#
# Disables upstream workflows that are irrelevant or harmful for this fork.
# Run this after every upstream merge to catch newly added noisy workflows.
#
# Usage:
#   bash .github/fork/disable-upstream-workflows.sh
#   bash .github/fork/disable-upstream-workflows.sh --dry-run
#
# Requirements: gh CLI authenticated to the fork repo (mrsimpson/opencode)

set -euo pipefail

REPO="mrsimpson/opencode"
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

disable() {
  local name="$1"
  local reason="$2"
  echo "Disabling: $name  ($reason)"
  if [[ "$DRY_RUN" == "false" ]]; then
    gh workflow disable "$name" --repo "$REPO" 2>/dev/null || \
      echo "  → skipped (may already be disabled or not found)"
  fi
}

echo "==> Fork: $REPO"
echo "==> Disabling upstream workflows irrelevant to this fork"
[[ "$DRY_RUN" == "true" ]] && echo "==> DRY RUN — no changes will be made"
echo ""

# ── Scheduled maintenance bots ─────────────────────────────────────────────
disable "close-issues.yml"         "daily bot irrelevant to fork's issue tracker"
disable "close-stale-prs.yml"      "daily stale-PR bot irrelevant to fork"
disable "compliance-close.yml"     "runs every 30 min, irrelevant to fork"
disable "daily-issues-recap.yml"   "daily recap irrelevant to fork"
disable "daily-pr-recap.yml"       "daily recap irrelevant to fork"

# ── Issue & PR triage bots ─────────────────────────────────────────────────
disable "triage.yml"               "AI triage bot not configured for fork"
disable "duplicate-issues.yml"     "duplicate-detection bot adds noise to fork"
disable "review.yml"               "upstream review bot not appropriate for fork"
disable "pr-management.yml"        "upstream team-membership checks will fail in fork"
disable "pr-standards.yml"         "upstream PR template enforcement adds noise to fork PRs"
disable "opencode.yml"             "/oc slash commands require bot tokens not in fork"

# ── Upstream CI (tests/typechecks/lint for upstream packages) ──────────────
disable "test.yml"                 "tests upstream packages; fork has fork-validate.yml"
disable "typecheck.yml"            "typechecks all packages; fork has fork-validate.yml"
disable "storybook.yml"            "Storybook not used by fork"

# ── Nix (not used in fork) ─────────────────────────────────────────────────
disable "nix-eval.yml"             "Nix not used in fork"
disable "nix-hashes.yml"           "Nix not used in fork"

# ── Upstream build/deploy (builds upstream artifacts, not fork artifacts) ──
disable "containers.yml"           "builds upstream containers; fork has build-opencode-router.yml"
disable "deploy.yml"               "SST/AWS deploy for upstream; fork has deploy-homelab.yml"
disable "generate.yml"             "SDK generation creates unwanted PRs in fork"
disable "beta.yml"                 "upstream beta branch sync irrelevant to fork"

# ── Vouch system (upstream governance) ─────────────────────────────────────
disable "vouch-check-pr.yml"       "upstream author-vouching system not used in fork"
disable "vouch-check-issue.yml"    "upstream author-vouching system not used in fork"
disable "vouch-manage-by-issue.yml" "upstream author-vouching system not used in fork"

# ── Release pipelines (upstream publishing) ────────────────────────────────
disable "release-github-action.yml" "upstream GitHub Action release; not applicable to fork"

echo ""
echo "==> Done."
echo ""
echo "Workflows intentionally kept enabled:"
echo "  fork-validate.yml              — fork PR validation (typecheck, tests, compatibility)"
echo "  build-opencode-router.yml      — fork Docker image build"
echo "  build-cloudflare-operator.yml  — fork Docker image build"
echo "  deploy-homelab.yml             — fork homelab deployment"
echo "  publish.yml                    — already guarded: if: repo == 'anomalyco/opencode'"
echo "  stats.yml                      — already guarded: if: repo == 'anomalyco/opencode'"
echo "  docs-update.yml                — already guarded: if: repo == 'anomalyco/opencode'"
echo "  notify-discord.yml             — release-only trigger, harmless"
echo "  sync-zed-extension.yml         — release-only trigger, harmless"
echo "  publish-github-action.yml      — tag-only trigger, harmless"
echo "  publish-vscode.yml             — tag-only trigger, harmless"
