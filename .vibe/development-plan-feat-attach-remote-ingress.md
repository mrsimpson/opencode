# Development Plan: opencode (feat/attach-remote-ingress branch)

*Generated on 2026-05-12 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal

Make `opencode attach` work on remote (Kubernetes) servers by provisioning the necessary Traefik IngressRoute for the `attach-<hash><routeSuffix>.<domain>` subdomain when a session pod starts.

Currently no ingress or Cloudflare tunnel entry is created for the attach subdomain, so remote attach connections fail at the network level — they never reach the router.

## Key Decisions

1. **No new Cloudflare DNS/Tunnel entries needed** — the wildcard `*.<domain>` DNS and certificate already cover `attach-<hash>-oc.<domain>`, so only a Traefik IngressRoute is required (same pattern as dev port routes).

2. **No oauth2 signin route** — the attach route uses password-based auth (HTTP Basic / query param / header), not OAuth. The router enforces this itself on the attach port. So only one IngressRoute (the app route, no middleware) is needed — no separate `/oauth2/*` signin route.

3. **Attach traffic must reach the router's attach port (4096), NOT the main port (3000)** — the main port (3000) is behind oauth2-proxy in production. The attach server runs separately on port 4096 without OAuth. Therefore, the IngressRoute must point to a Service port that maps to container port 4096.

4. **A separate Kubernetes Service port for 4096** is needed in `homelab/src/index.ts` — `ExposedWebApp` only creates a single Service port (3000). We create a separate `k8s.core.v1.Service` named `<APP_NAME>-attach` (e.g. `code-attach`) that selects the same pods and exposes port 4096, so Traefik's IngressRoute can reference it without needing oauth2.

5. **`attachServiceName` is a separate config field** — the attach IngressRoute must reference the `code-attach` Service (not the main `code` Service on port 80). Config has `attachServiceName` (env `ATTACH_SERVICE_NAME`, default `<routerServiceName>-attach`) so the operator knows which Service to use.

6. **Stale attach IngressRoute reconciliation** — the reconcile loop now detects `-attach` suffixed routes and calls `deleteAttachIngressRoute` (not `deleteIngressRoutes`) to clean them up correctly.

## Notes

### Architecture of the existing port exposure pipeline

```
Pod starts
  └─ onPodAdded()
       ├─ createDnsRecord(sessionHostname)       ← Cloudflare DNS CNAME
       ├─ createTunnelRoute(sessionHostname)     ← Cloudflare Tunnel ingress rule
       └─ createIngressRoutes(sessionHostname)  ← 2x Traefik IngressRoute (signin + app, with oauth2 chain)

User dev server detected by port-watcher
  └─ provisionPortRoute(hash, port)
       └─ createIngressRoutes(portHostname)      ← 2x Traefik IngressRoute (same pattern)

Pod deleted
  └─ onPodDeleted()
       ├─ deleteTunnelRoute(sessionHostname)
       ├─ deleteIngressRoutes(sessionHostname)
       └─ deleteIngressRoutes(portHostname)  ← for each provisioned dev port
```

### Attach hostname format
`attach-<hash><routeSuffix>.<domain>` — e.g. `attach-abc123def456-oc.no-panic.org`

Configured by:
- `opencode-router`: `ATTACH_ROUTE_PREFIX` (default `"attach-"`), `ATTACH_PORT` (default `4096`)
- `opencode-cloudflare-operator`: needs matching config (`ATTACH_ROUTE_PREFIX`, `ATTACH_SERVICE_PORT`)

### Key files

| Concern | File |
|---|---|
| Attach CLI command | `packages/opencode/src/cli/cmd/tui/attach.ts` |
| Router attach server | `packages/opencode-router/src/index.ts` (port 4096) |
| Router config | `packages/opencode-router/src/config.ts` |
| Operator config | `deployment/opencode-cloudflare-operator/src/config.ts` |
| Operator IngressRoute helpers | `deployment/opencode-cloudflare-operator/src/ingressroute.ts` |
| Operator main loop | `deployment/opencode-cloudflare-operator/src/index.ts` |
| Pulumi homelab deployment | `deployment/homelab/src/index.ts` |
| Operator tests | `deployment/opencode-cloudflare-operator/tests/operator.test.ts` |

### Files to change

| File | Change |
|---|---|
| `opencode-cloudflare-operator/src/config.ts` | Add `attachRoutePrefix`, `attachServicePort`; add `sessionAttachHostname()` helper |
| `opencode-cloudflare-operator/src/ingressroute.ts` | Add `createAttachIngressRoute` / `deleteAttachIngressRoute` (no oauth2 middleware, uses attach port) |
| `opencode-cloudflare-operator/src/index.ts` | Provision/remove attach route in `onPodAdded`, `onPodDeleted`, and `reconcileOnStartup` |
| `homelab/src/index.ts` | Expose attach port 4096 on router Service; pass `ATTACH_ROUTE_PREFIX` + `ATTACH_SERVICE_PORT` to operator sidecar env |
| `opencode-cloudflare-operator/tests/operator.test.ts` | Add `attachRoutePrefix`/`attachServicePort`/`sessionAttachHostname` to mock config; add tests for attach route provisioning |

## Explore
<!-- beads-phase-id: opencode-10.1 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-10.1.1` Understand attach feature and existing port exposure mechanism
- [x] `opencode-10.1.2` Document key decisions and files to change in plan

## Plan
<!-- beads-phase-id: opencode-10.2 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-10.2.1` Add attachRoutePrefix, attachServicePort, sessionAttachHostname to operator config
- [x] `opencode-10.2.2` Add createAttachIngressRoute / deleteAttachIngressRoute to ingressroute.ts
- [x] `opencode-10.2.3` Wire attach route provisioning in operator index.ts (pod add/delete/reconcile)
- [x] `opencode-10.2.4` Expose attach port 4096 on router Service and pass env vars in homelab/src/index.ts
- [x] `opencode-10.2.5` Update operator tests for attach route provisioning

## Code
<!-- beads-phase-id: opencode-10.3 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-10.3.1` Add attachRoutePrefix, attachServicePort, sessionAttachHostname to operator config.ts
- [x] `opencode-10.3.2` Add createAttachIngressRoute / deleteAttachIngressRoute to ingressroute.ts
- [x] `opencode-10.3.3` Wire attach route in operator index.ts (pod add/delete/reconcile)
- [x] `opencode-10.3.4` Expose attach port 4096 on router Service and pass env vars in homelab/src/index.ts
- [x] `opencode-10.3.5` Update operator tests for attach route provisioning

## Commit
<!-- beads-phase-id: opencode-10.4 -->
### Tasks
<!-- beads-synced: 2026-05-12 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

