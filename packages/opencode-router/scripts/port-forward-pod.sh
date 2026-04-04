#!/usr/bin/env bash
# Port-forward the current user's opencode pod to localhost:4096.
# Required for local dev when the router runs outside the cluster (pod IPs unreachable).
#
# Usage: ./scripts/port-forward-pod.sh [email]
# If email is not provided, uses DEV_EMAIL from .env.local

set -euo pipefail

NAMESPACE="${OPENCODE_NAMESPACE:-opencode-router}"
LOCAL_PORT="${LOCAL_PORT:-4096}"
POD_PORT="${POD_PORT:-4096}"

# Get email from arg or DEV_EMAIL
EMAIL="${1:-}"
if [ -z "$EMAIL" ] && [ -f .env.local ]; then
  EMAIL=$(grep -E '^export DEV_EMAIL=' .env.local | cut -d= -f2 | tr -d '"' | tr -d "'")
fi
if [ -z "$EMAIL" ]; then
  echo "Usage: $0 <email>  OR set DEV_EMAIL in .env.local"
  exit 1
fi

# Compute hash (sha256, first 12 hex chars) — matches getUserHash() in pod-manager.ts
HASH=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d ' ' | shasum -a 256 | cut -c1-12)
POD_NAME="opencode-user-${HASH}"

echo "→ Email: $EMAIL"
echo "→ Pod: $POD_NAME (namespace: $NAMESPACE)"
echo "→ Port-forwarding: localhost:${LOCAL_PORT} → pod:${POD_PORT}"
echo ""
echo "Set in .env.local: export DEV_POD_PROXY_TARGET=http://localhost:${LOCAL_PORT}"
echo ""

kubectl port-forward "${POD_NAME}" "${LOCAL_PORT}:${POD_PORT}" -n "${NAMESPACE}"
