# opencode-cloudflare-operator

A lightweight Kubernetes operator that runs as a sidecar in the opencode-router pod. It watches for session pods created by the router and provisions/deprovisions per-session Cloudflare DNS records and Traefik IngressRoutes on demand.

## Why This Exists

The opencode-router creates one Kubernetes Pod per (user, repo, branch) session. Each session needs its own public hostname (`<hash>-oc.<domain>`) so the router can identify which session a request belongs to by reading the `Host` header.

The `*.<domain>` Cloudflare Universal SSL certificate only covers **first-level subdomains** of `<domain>`. Session URLs are therefore `<hash>-oc.<domain>` (dash, not dot) — staying at the first level, covered by the wildcard cert.

These hostnames cannot be pre-provisioned by Pulumi because they are created at runtime. This operator bridges that gap.

## What It Does

On **pod ADDED** (session started):
1. Creates a Cloudflare CNAME DNS record: `<hash>-oc.<domain>` → `<tunnel-id>.cfargotunnel.com`
2. Adds a tunnel ingress rule to the Cloudflare Tunnel config: `<hash>-oc.<domain>` → router service
3. Creates two Traefik IngressRoute resources in the `opencode-router` namespace:
   - `opencode-session-<hash>-oc-signin` — routes `/oauth2/*` to `oauth2-proxy-users` (auth flow)
   - `opencode-session-<hash>-oc-app` — routes `/*` to the `opencode-router` service, protected by the `opencode-router-oauth2-chain` middleware

On **pod DELETED** (session cleaned up):
1. Deletes the Cloudflare DNS record
2. Removes the tunnel ingress rule
3. Deletes the two IngressRoute resources

All operations are idempotent — safe to run with multiple operator replicas (2 router replicas = 2 operator sidecars both watching pods).

## Deployment

The operator runs as a sidecar container in the opencode-router Deployment. It shares:
- The pod's ServiceAccount (which has RBAC to manage pods and IngressRoutes)
- The pod's imagePullSecrets
- The pod's network namespace

The Cloudflare API token is injected from a dedicated Secret (`opencode-router-cf-credentials`).

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `CF_API_TOKEN` | Yes | — | Cloudflare API token (DNS:Edit + Zone:Read + Tunnel:Edit) |
| `CF_ZONE_ID` | Yes | — | Cloudflare Zone ID |
| `CF_TUNNEL_ID` | Yes | — | Cloudflare Tunnel ID |
| `DOMAIN` | Yes | — | Base domain (e.g. `no-panic.org`) |
| `ROUTE_SUFFIX` | No | `""` | Suffix for session hostnames (e.g. `-oc`) |
| `ROUTER_SERVICE_URL` | Yes | — | In-cluster router URL (e.g. `http://opencode-router.opencode-router.svc.cluster.local:80`) |
| `WATCH_NAMESPACE` | No | `opencode-router` | Namespace to watch for session pods |
| `POD_LABEL_SELECTOR` | No | `app.kubernetes.io/managed-by=opencode-router` | Label selector for session pods |
| `INGRESSROUTE_NAMESPACE` | No | `$WATCH_NAMESPACE` | Namespace where IngressRoutes are created |
| `OAUTH2_CHAIN_MIDDLEWARE` | No | `opencode-router-oauth2-chain` | Name of the Traefik middleware chain for OAuth2 auth |
| `ROUTER_SERVICE_NAME` | No | `opencode-router` | Name of the Kubernetes Service for the router |
| `HEALTH_PORT` | No | `8080` | Port for the `/healthz` health check endpoint |

## Building

```bash
# From the homelab repo root:
bash images/opencode-cloudflare-operator/build.sh --push --revision <n>

# Then update Pulumi config:
pulumi config set opencode:cfOperatorImage "ghcr.io/mrsimpson/opencode-cloudflare-operator:0.1.0-homelab.<n>"
```

## RBAC Requirements

The ServiceAccount running the operator needs:

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["traefik.io"]
    resources: ["ingressroutes"]
    verbs: ["get", "list", "create", "delete"]
```

These are provided by the `opencode-router` Role in `packages/apps/opencode-router/src/index.ts`.
