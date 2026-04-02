# ADR-001: Per-User Pod Isolation via Reverse Proxy Router

**Status:** Accepted  
**Date:** 2026-04-02

## Context

OpenCode provides a web-based AI coding assistant via `opencode serve`. A single instance stores all state (sessions, conversation history, file system) in a local SQLite database and the local filesystem. There is no built-in concept of user accounts or multi-tenancy.

When deploying OpenCode for a team behind an authentication proxy (e.g. oauth2-proxy), all authenticated users currently share a single instance. This means:

- Users can see each other's sessions and conversation history
- File system changes from one user affect all others
- There is no way to attribute API usage to individual users
- A misbehaving session can degrade the experience for everyone

We need per-user isolation without modifying OpenCode's core codebase.

## Decision

We will create a **reverse proxy router** (`opencode-router`) that dynamically provisions a separate Kubernetes Pod for each authenticated user. The router:

1. Reads the user's identity from the `X-Auth-Request-Email` HTTP header (set by the upstream auth proxy)
2. Maps each user to a deterministic Pod and PVC via a SHA-256 hash of their email
3. Creates the Pod and PVC on first access
4. Proxies all subsequent HTTP and WebSocket traffic to the user's Pod
5. Deletes idle Pods after a configurable timeout, preserving PVCs

### Alternatives Considered

#### A. Modify OpenCode to support multi-tenancy natively

**Rejected.** This would require significant changes to OpenCode's data layer (multi-tenant SQLite or migration to a shared database), session management, and file system isolation. It couples the isolation concern to the application, making it harder to maintain across upstream updates. The router approach achieves the same goal with zero changes to OpenCode.

#### B. One Deployment per user (static provisioning)

**Rejected.** Pre-provisioning a Deployment for each user requires manual intervention for onboarding/offboarding and wastes resources for inactive users. Dynamic provisioning scales to zero when idle and handles new users automatically.

#### C. Namespace-per-user isolation

**Rejected.** While providing stronger isolation boundaries, namespace-per-user significantly complicates RBAC management, resource quota configuration, and ConfigMap/Secret distribution. Pod-level isolation within a single namespace is sufficient for this use case — users are authenticated team members, not untrusted tenants.

#### D. Virtual clusters (vCluster) or container-in-container (sysbox)

**Rejected.** These provide stronger isolation but add operational complexity disproportionate to the threat model. Users are authenticated via the organization's identity provider; the goal is session/data separation, not security sandboxing against malicious users.

## Architecture

```
Internet
    │
    ▼
┌──────────────┐
│  Ingress     │
│  (Traefik)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐    X-Auth-Request-Email
│ oauth2-proxy │    ─────────────────────▶
│  (ForwardAuth│                          
│   middleware)│                          
└──────┬───────┘                          
       │                                  
       ▼                                  
┌──────────────────┐                      
│ opencode-router  │──┐                   
│ (this service)   │  │                   
└──────────────────┘  │                   
       │              │                   
       ▼              ▼                   
┌────────────┐  ┌────────────┐            
│ user-pod-A │  │ user-pod-B │  ...       
│ (opencode  │  │ (opencode  │            
│  serve)    │  │  serve)    │            
├────────────┤  ├────────────┤            
│ PVC-A      │  │ PVC-B      │            
└────────────┘  └────────────┘            
```

## Design Decisions

### D1: Deterministic pod naming via email hash

**Decision:** Pod names are `opencode-user-<sha256(email)[0:12]>`.

**Rationale:** This is deterministic (same email always maps to same pod), DNS-safe (hex chars only), and reasonably collision-resistant (12 hex chars = 48 bits, sufficient for team-scale deployments of hundreds of users). No external state or database is needed to track the mapping.

**Trade-off:** If two emails collide on the first 12 chars of their SHA-256 hash, they would share a pod. At team scale (< 1000 users), this probability is negligible (~10^-9). For deployments exceeding thousands of users, the hash prefix length should be increased.

### D2: PVCs survive pod deletion

**Decision:** Idle cleanup deletes Pods but preserves PersistentVolumeClaims.

**Rationale:** The primary cost of idle pods is compute (CPU/memory), not storage. Preserving PVCs means returning users get their full session history, conversation logs, and workspace files without re-cloning. Storage costs for 2Gi PVCs are minimal. Manual PVC cleanup can be done via `kubectl` or a separate job for offboarded users.

**Trade-off:** Orphaned PVCs accumulate for users who never return. A future enhancement could add a separate PVC cleanup job with a longer timeout (e.g. 30 days).

### D3: In-cluster Kubernetes API access

**Decision:** The router uses the in-cluster service account for Kubernetes API access (`@kubernetes/client-node` with `KubeConfig.loadFromCluster()`).

**Rationale:** The router runs inside the cluster it manages. In-cluster auth is the standard, secure approach — no kubeconfig files to manage, credentials rotate automatically, and RBAC scopes permissions precisely.

### D4: http-proxy for proxying

**Decision:** Use the `http-proxy` npm package for HTTP and WebSocket proxying.

**Rationale:** `http-proxy` is battle-tested (380M+ weekly downloads), supports WebSocket upgrades natively, and is simple to integrate with Node.js `http.Server`. OpenCode's web UI relies on WebSocket connections for real-time updates and terminal PTY, making native WS support essential. No framework (Express, Fastify) is needed — the router's logic is simple enough for raw `http.createServer`.

**Alternatives considered:**
- `node-http-proxy-json` — unnecessary, we don't need response body manipulation
- nginx/envoy sidecar — adds operational complexity for dynamic upstream management
- Custom proxy with `fetch` — lacks WebSocket support without significant additional code

### D5: Node.js runtime (not Bun)

**Decision:** The router targets Node.js 22, not Bun.

**Rationale:** `@kubernetes/client-node` is tested and maintained against Node.js. While Bun has broad Node.js compatibility, the Kubernetes client uses features (HTTP/2, specific TLS behaviors) where Node.js compatibility is battle-proven. The router is I/O-bound (proxying requests, K8s API calls), so Bun's performance advantages in compute-heavy workloads don't apply. Using Node.js avoids an unnecessary compatibility risk.

### D6: Loading page with client-side refresh

**Decision:** When a user's pod is not yet ready, return an HTML page that auto-refreshes every 3 seconds.

**Rationale:** This is the simplest approach that works. Pod startup (pull image + init container + readiness) takes 5-15 seconds. Server-Sent Events or long-polling would add complexity for marginal UX improvement. The loading page is self-contained HTML with no external dependencies.

**Trade-off:** Users see a brief flash on each refresh until the pod is ready. For a more polished experience, a future iteration could use SSE to push a redirect once the pod is ready.

### D7: Activity tracking via pod annotations

**Decision:** Last activity time is stored as a Kubernetes annotation (`opencode.ai/last-activity`) on the user's pod, updated on each proxied request.

**Rationale:** This avoids external state (no Redis, no database). Annotations are lightweight metadata on existing resources. The cleanup loop lists pods with the `opencode.ai/user-hash` label and checks annotations. Since the router is the only writer, there are no concurrency concerns.

**Trade-off:** Frequent annotation updates (every request) generate K8s API load. To mitigate this, the router throttles updates to at most once per minute per user (in-memory timestamp cache, write only when >60s since last update).

### D8: Single namespace for all resources

**Decision:** The router, user pods, PVCs, ConfigMaps, and Secrets all reside in a single Kubernetes namespace.

**Rationale:** Simplifies RBAC (one Role, one RoleBinding), ConfigMap/Secret sharing (no cross-namespace references), and operational visibility (`kubectl get pods -n opencode` shows everything). The isolation boundary is at the pod/PVC level, not the namespace level.

## Consequences

### Positive
- Zero changes to OpenCode — works with any version of `opencode serve`
- Users get full isolation of sessions, history, and workspace
- Idle cleanup keeps compute costs proportional to active users
- PVC persistence means no data loss on pod recycling
- Stateless router can be scaled horizontally for availability
- New users are onboarded automatically on first visit

### Negative
- Each active user consumes a full pod's worth of resources (CPU, memory)
- Pod startup latency on first visit or after idle cleanup (5-15 seconds)
- Orphaned PVCs require manual or automated cleanup for offboarded users
- Router adds a network hop and a single point of failure (mitigated by replicas)
- K8s API rate limits could be reached with very frequent annotation updates (mitigated by throttling)

### Risks
- **K8s API availability:** If the Kubernetes API is down, the router cannot create or discover pods. Mitigation: the router should cache known pod IPs in memory as a short-term fallback.
- **Resource exhaustion:** A large number of concurrent users could exhaust namespace resource quotas. Mitigation: configure `LimitRange` and `ResourceQuota` on the namespace.
- **Image pull latency:** First pod creation requires pulling the OpenCode image. Mitigation: use `imagePullPolicy: IfNotPresent` and pre-pull images on nodes via a DaemonSet.
