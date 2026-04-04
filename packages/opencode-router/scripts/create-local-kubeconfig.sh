#!/usr/bin/env bash
# Create a temporary kubeconfig for local opencode-router development.
# This uses the opencode-router ServiceAccount token from the live cluster.
#
# Prerequisites:
#   - kubectl configured and pointing at the homelab cluster
#   - opencode-router namespace and ServiceAccount already deployed (pulumi up)
#
# Usage:
#   ./scripts/create-local-kubeconfig.sh
#   # Then: source .env.local && node dist/index.js

set -euo pipefail

NAMESPACE="${OPENCODE_NAMESPACE:-opencode-router}"
SA_NAME="opencode-router"
KUBECONFIG_OUT="${KUBECONFIG_OUT:-/tmp/opencode-router-local.kubeconfig}"
TOKEN_DURATION="${TOKEN_DURATION:-24h}"

echo "→ Creating ServiceAccount token for ${SA_NAME} in namespace ${NAMESPACE}..."
TOKEN=$(kubectl create token "${SA_NAME}" \
  --namespace "${NAMESPACE}" \
  --duration "${TOKEN_DURATION}")

echo "→ Getting cluster server URL..."
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA_DATA=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

echo "→ Writing kubeconfig to ${KUBECONFIG_OUT}..."
cat > "${KUBECONFIG_OUT}" <<EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${CA_DATA}
    server: ${SERVER}
  name: homelab
contexts:
- context:
    cluster: homelab
    namespace: ${NAMESPACE}
    user: ${SA_NAME}-sa
  name: opencode-router-local
current-context: opencode-router-local
users:
- name: ${SA_NAME}-sa
  user:
    token: ${TOKEN}
EOF

echo "✓ Kubeconfig written to ${KUBECONFIG_OUT} (valid for ${TOKEN_DURATION})"
echo ""
echo "Next steps:"
echo "  1. Copy .env.local.example to .env.local (already has KUBECONFIG=${KUBECONFIG_OUT})"
echo "  2. source .env.local && node dist/index.js"
echo "  3. In another terminal: cd ../opencode-router-app && bun run dev"
echo "  4. Open http://localhost:5173"
