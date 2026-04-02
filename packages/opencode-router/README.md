# opencode-router

A lightweight HTTP/WebSocket reverse proxy that provides per-user isolation for [OpenCode](https://opencode.ai) deployments on Kubernetes.

## Problem

OpenCode's `opencode serve` command runs a single server instance. When multiple users share that instance, they see each other's sessions, share the same filesystem, and operate under the same API keys. There is no user isolation.

For teams or shared environments, each user needs their own OpenCode instance with:

- **Isolated sessions** — users only see their own conversation history
- **Isolated filesystem** — each user works in their own workspace
- **Persistent state** — sessions survive pod restarts and idle cleanup
- **Shared configuration** — API keys and agent configs are managed centrally

## What This Does

`opencode-router` sits between an authentication proxy (e.g. oauth2-proxy) and dynamically provisioned OpenCode pods. It:

1. **Identifies users** via the `X-Auth-Request-Email` header (set by oauth2-proxy after GitHub/Google/OIDC authentication)
2. **Provisions infrastructure** on first visit — creates a PersistentVolumeClaim and a Pod running `opencode serve` for that user
3. **Proxies traffic** — forwards all HTTP requests and WebSocket connections to the user's pod
4. **Cleans up idle pods** — deletes pods that have been inactive beyond a configurable threshold, while preserving PVCs so state persists

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ oauth2-proxy │────▶│  opencode-router  │────▶│ opencode-user-a3f2  │
│  (authn)     │     │  (routing/mgmt)   │     │ (opencode serve)    │
└──────────────┘     └──────────────────┘     └─────────────────────┘
                              │                ┌─────────────────────┐
                              └───────────────▶│ opencode-user-b7c1  │
                                               │ (opencode serve)    │
                                               └─────────────────────┘
```

## How It Works

### User-to-Pod Mapping

Each authenticated user's email address is hashed (SHA-256, first 12 hex chars) to produce a deterministic, DNS-safe pod name: `opencode-user-<hash>`. The same hash is used for the PVC name (`opencode-pvc-<hash>`), ensuring a stable mapping across pod restarts.

### Pod Lifecycle

| Event | Action |
|---|---|
| First request from a new user | Create PVC + Pod with git-clone init container |
| Request while pod is starting | Return a loading page (auto-refreshes every 3s) |
| Request to a running pod | Proxy HTTP/WebSocket to pod IP |
| Pod idle > threshold | Delete pod (PVC preserved) |
| Returning user after idle cleanup | Recreate pod, reattach existing PVC |

### Git Repository Initialization

On first pod creation, an init container (`alpine/git`) clones a configurable default repository into the workspace. A guard (`test -d /workspace/.git`) prevents re-cloning on subsequent pod restarts since the PVC retains the data.

### What Gets Isolated vs. Shared

| Resource | Per-User | Shared |
|---|---|---|
| SQLite database (sessions, history) | Per-user PVC | — |
| Workspace / filesystem | Per-user PVC | — |
| API keys (ANTHROPIC_API_KEY, etc.) | — | K8s Secret |
| Agent configuration | — | K8s ConfigMap |
| OpenCode config (opencode.json) | — | K8s ConfigMap |

## Configuration

All configuration is via environment variables on the router pod:

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_IMAGE` | Yes | — | Docker image for user OpenCode pods |
| `OPENCODE_NAMESPACE` | No | `opencode` | Kubernetes namespace for all resources |
| `IDLE_TIMEOUT_MINUTES` | No | `30` | Minutes of inactivity before pod deletion |
| `API_KEY_SECRET_NAME` | No | `opencode-api-keys` | K8s Secret name containing API keys |
| `CONFIG_MAP_NAME` | No | `opencode-config-dir` | K8s ConfigMap with shared OpenCode config |
| `STORAGE_CLASS` | No | `""` (cluster default) | StorageClass for user PVCs |
| `STORAGE_SIZE` | No | `2Gi` | PVC size per user |
| `DEFAULT_GIT_REPO` | No | — | Git repo URL to clone into new workspaces |
| `PORT` | No | `3000` | Port the router listens on |

## Prerequisites

- Kubernetes cluster with RBAC enabled
- An authentication proxy (oauth2-proxy or similar) that sets `X-Auth-Request-Email`
- A ServiceAccount for the router with permissions to manage Pods and PVCs in its namespace
- The OpenCode Docker image available to the cluster

## Deployment

The router runs as a standard Kubernetes Deployment. It requires a ServiceAccount with a Role granting:

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "create"]
```

The router itself is stateless — it discovers user pods via the Kubernetes API on every request. Multiple router replicas can run behind a Service for availability (all replicas see the same pods).
