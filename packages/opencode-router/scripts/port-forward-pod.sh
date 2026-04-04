#!/usr/bin/env bash
# Port-forward a running opencode session pod to localhost:4096.
# Required for local dev when the router runs outside the cluster (pod IPs unreachable).
#
# Usage:
#   ./scripts/port-forward-pod.sh              # auto-selects if only one pod running
#   ./scripts/port-forward-pod.sh <pod-name>   # forward a specific pod

set -euo pipefail

NAMESPACE="${OPENCODE_NAMESPACE:-opencode-router}"
LOCAL_PORT="${LOCAL_PORT:-4096}"
POD_PORT="${POD_PORT:-4096}"
LABEL_SELECTOR="app.kubernetes.io/managed-by=opencode-router"

POD_NAME="${1:-}"

if [ -z "$POD_NAME" ]; then
  # List all running session pods
  PODS=$(kubectl get pods -n "${NAMESPACE}" -l "${LABEL_SELECTOR}" \
    --field-selector=status.phase=Running \
    --no-headers -o custom-columns=":metadata.name" 2>/dev/null || true)

  if [ -z "$PODS" ]; then
    echo "✗ No running session pods found in namespace '${NAMESPACE}'"
    echo "  Create a session at http://localhost:3002 first."
    exit 1
  fi

  COUNT=$(echo "$PODS" | wc -l | tr -d ' ')
  if [ "$COUNT" -eq 1 ]; then
    POD_NAME="$PODS"
  else
    echo "Multiple running pods — pick one:"
    echo "$PODS" | nl -w2 -s'. '
    read -r -p "Enter number: " CHOICE
    POD_NAME=$(echo "$PODS" | sed -n "${CHOICE}p")
  fi
fi

echo "→ Pod: $POD_NAME (namespace: $NAMESPACE)"
echo "→ Port-forwarding: localhost:${LOCAL_PORT} → pod:${POD_PORT}"
echo ""
echo "Router config: export DEV_POD_PROXY_TARGET=http://localhost:${LOCAL_PORT}"
echo ""

kubectl port-forward "${POD_NAME}" "${LOCAL_PORT}:${POD_PORT}" -n "${NAMESPACE}"
