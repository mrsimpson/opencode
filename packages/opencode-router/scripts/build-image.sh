#!/usr/bin/env bash
# build.sh — Build and push the opencode-router image to GHCR.
#
# Usage:
#   ./images/opencode-router/build.sh [--push] [--revision <n>] [--ghcr-user <user>] [--token <PAT>]
#
# The image tag is: ghcr.io/<user>/opencode-router:<package-version>-homelab.<revision>
# e.g.  ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.1
#
# The build context is the opencode monorepo root (~/projects/open-source/opencode).
# The Dockerfile lives at packages/opencode-router/Dockerfile within that monorepo.
#
# Options:
#   --push              Push the image after building (default: build only)
#   --revision <n>      Custom revision suffix (default: 1)
#   --ghcr-user <user>  GitHub username / org for GHCR (default: mrsimpson)
#   --token <PAT>       GitHub PAT with write:packages scope (bypasses keychain)
#                       Can also be set via GITHUB_PAT env var
#   --monorepo <path>   Path to the opencode monorepo root
#                       (default: ~/projects/open-source/opencode)
#
# Examples:
#   ./images/opencode-router/build.sh                                   # build only
#   ./images/opencode-router/build.sh --push --token ghp_xxx            # build + push
#   ./images/opencode-router/build.sh --push --revision 2               # bump homelab revision
#   GITHUB_PAT=ghp_xxx ./images/opencode-router/build.sh --push        # via env var

set -euo pipefail

GHCR_USER="mrsimpson"
IMAGE_NAME="opencode-router"

PUSH=false
REVISION=1
TOKEN="${GITHUB_PAT:-}"
MONOREPO="${HOME}/projects/open-source/opencode"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)         PUSH=true;          shift ;;
    --revision)     REVISION="$2";      shift 2 ;;
    --ghcr-user)    GHCR_USER="$2";     shift 2 ;;
    --token)        TOKEN="$2";         shift 2 ;;
    --monorepo)     MONOREPO="$2";      shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve package version from monorepo
# ---------------------------------------------------------------------------
PACKAGE_JSON="${MONOREPO}/packages/opencode-router/package.json"

if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo "✗ Cannot find ${PACKAGE_JSON}" >&2
  echo "  Is the monorepo at ${MONOREPO}? Use --monorepo <path> to override." >&2
  exit 1
fi

PACKAGE_VERSION=$(node -p "require('${PACKAGE_JSON}').version" 2>/dev/null)

if [[ -z "${PACKAGE_VERSION}" ]]; then
  echo "✗ Could not read version from ${PACKAGE_JSON}" >&2
  exit 1
fi

echo "→ opencode-router package version: ${PACKAGE_VERSION}"
echo "  Revision         : ${REVISION}"

TAG="${PACKAGE_VERSION}-homelab.${REVISION}"
REGISTRY="ghcr.io/${GHCR_USER}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"
DOCKERFILE="${MONOREPO}/packages/opencode-router/Dockerfile"

echo "  Final image tag  : ${FULL_IMAGE}"
echo "  Build context    : ${MONOREPO}"
echo "  Dockerfile       : ${DOCKERFILE}"
echo ""

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "→ Building ${FULL_IMAGE} (linux/amd64) ..."
# Always target linux/amd64 — the homelab cluster runs on x86_64.
# Build context is the monorepo root so the Dockerfile can access other packages.
docker buildx build \
  --platform linux/amd64 \
  --file "${DOCKERFILE}" \
  --label "org.opencontainers.image.version=${TAG}" \
  --label "org.opencontainers.image.source=https://github.com/mrsimpson/homelab" \
  --label "org.opencontainers.image.description=opencode-router: per-user pod router for opencode" \
  --tag "${FULL_IMAGE}" \
  --tag "${LATEST_IMAGE}" \
  --load \
  "${MONOREPO}"

echo "✓ Build complete: ${FULL_IMAGE}"
echo ""

# ---------------------------------------------------------------------------
# Push (optional)
# ---------------------------------------------------------------------------
if [[ "${PUSH}" == "true" ]]; then
  # If a token was provided, log in explicitly (bypasses keychain)
  if [[ -n "${TOKEN}" ]]; then
    echo "→ Logging in to ghcr.io as ${GHCR_USER} ..."
    echo "${TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi

  echo "→ Pushing ${FULL_IMAGE} ..."
  # Re-run buildx with --push to push the linux/amd64 manifest directly to the registry
  docker buildx build \
    --platform linux/amd64 \
    --file "${DOCKERFILE}" \
    --label "org.opencontainers.image.version=${TAG}" \
    --label "org.opencontainers.image.source=https://github.com/mrsimpson/homelab" \
    --label "org.opencontainers.image.description=opencode-router: per-user pod router for opencode" \
    --tag "${FULL_IMAGE}" \
    --tag "${LATEST_IMAGE}" \
    --push \
    "${MONOREPO}"
  echo "✓ Pushed: ${FULL_IMAGE}"
  echo "✓ Pushed: ${LATEST_IMAGE}"
  echo ""
  echo "Update the Pulumi config to:"
  echo "  pulumi config set opencode:routerImage \"${FULL_IMAGE}\""
else
  echo "ℹ  Skipping push (pass --push to push to ${REGISTRY})"
  echo ""
  echo "When ready, run:"
  echo "  ${BASH_SOURCE[0]} --push --token \$GITHUB_PAT"
fi
