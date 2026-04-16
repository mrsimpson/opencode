# opencode homelab deployment

This directory contains the [Pulumi](https://www.pulumi.com/) stack that deploys opencode to the [homelab Kubernetes cluster](https://github.com/mrsimpson/homelab).

## What this deploys

- **opencode-router** — HTTP router that spins up per-user opencode pods on demand and routes sessions to them
- **opencode-cloudflare-operator** sidecar — watches session pods and dynamically creates Cloudflare tunnel DNS records + Traefik IngressRoutes so each session is reachable at `<hash>-oc.<domain>`
- Supporting Kubernetes resources: Namespace, RBAC, Secrets, ConfigMap, ExternalSecret (GHCR pull credentials), Cloudflare DNS CNAME for the main `code.<domain>` entry point

Authentication is handled by the shared [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) deployment in the cluster (GitHub OAuth).

## Why this directory is at the monorepo root (not inside `packages/`)

The opencode monorepo uses [bun](https://bun.sh/) workspaces. Bun's workspace `catalog:` protocol is not supported by npm/Node.js tooling, which means any Pulumi stack (which runs with `node`, not `bun`) placed inside `packages/` would fail to install its dependencies.

Keeping this directory at `homelab/` (outside the bun workspace glob `packages/*`) means it is a plain npm package that npm, Node.js, and Pulumi can handle without modification. It is intentionally **not** part of the opencode bun workspace.

## How it works

```
opencode repo (this repo)          homelab repo
──────────────────────────         ──────────────────────
packages/opencode-router/    ───►  ghcr.io/mrsimpson/opencode-router
packages/opencode-cloudflare-      ghcr.io/mrsimpson/opencode-cloudflare-operator
  operator/                  ───►

homelab/                           github.com/mrsimpson/homelab
  src/index.ts  ─── reads ──────►  StackReference outputs (tunnelCname, zoneId, domain)
                ─── npm ──────────► @mrsimpson/homelab-core-components (npmjs.com)
                     │
                     └─ createHomelabContextFromStack()
                        ExposedWebApp (Deployment + Service + IngressRoutes + DNS)
```

The `homelab/` stack:

1. References the homelab base stack via [Pulumi StackReference](https://www.pulumi.com/docs/concepts/stack/#stackreferences) to get shared infrastructure facts (Cloudflare tunnel CNAME, zone ID, domain)
2. Uses [`@mrsimpson/homelab-core-components`](https://www.npmjs.com/package/@mrsimpson/homelab-core-components) — a published npm package from the homelab repo — to deploy the router as an `ExposedWebApp` (Traefik OAuth2-Proxy routes, Cloudflare DNS, Pod Security Standards, etc.)
3. Adds the cloudflare-operator as an `extraContainer` sidecar on the router pod

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Docker](https://docs.docker.com/get-docker/) with buildx (for local image builds)
- Node.js ≥ 24
- `PULUMI_ACCESS_TOKEN` — Pulumi Cloud token with access to the `mrsimpson` org
- `KUBECONFIG` — kubeconfig scoped to the `code` namespace on the homelab cluster
- `GITHUB_PAT` — GitHub PAT with `write:packages` scope (for pushing images to GHCR)

## Local development workflow

```bash
# First time: install dependencies
npm install

# See all available targets
make help

# Build both Docker images locally
make build

# Build + push images to GHCR + deploy to cluster (full release cycle)
make release

# Or step by step:
make build-push   # build and push images
make deploy       # update Pulumi image config + pulumi up

# Dry-run: see what would change without applying
make preview

# Tear down everything
make destroy
```

The `deploy` target automatically updates the Pulumi stack config with the newly built image tags before running `pulumi up`. Image tags follow the pattern `<package-version>-local.<git-sha>` (e.g. `0.0.1-local.a3f1c2d`).

## Pulumi stack config

Stack config lives in `Pulumi.dev.yaml`. Secrets are encrypted by Pulumi.

| Key                    | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `code:routerImage`     | opencode-router container image (tag updated by `make deploy`) |
| `code:cfOperatorImage` | cloudflare-operator container image                            |
| `code:opencodeImage`   | opencode session pod image                                     |
| `code:homelabStack`    | Pulumi StackReference to the homelab base stack                |
| `cloudflare:apiToken`  | Cloudflare API token (secret)                                  |

## CI/CD

Images are built and pushed automatically by GitHub Actions:

- [`build-opencode-router.yml`](../.github/workflows/build-opencode-router.yml) — triggers on changes to `packages/opencode-router/`
- [`build-cloudflare-operator.yml`](../.github/workflows/build-cloudflare-operator.yml) — triggers on changes to `packages/opencode-cloudflare-operator/`
- [`deploy-homelab.yml`](../.github/workflows/deploy-homelab.yml) — runs `pulumi up` after the operator image build succeeds

## Session pod configuration

opencode has two config layers:

- **Static config** (agents, skills, plugins, MCP) is baked into the image at `images/opencode/config/opencode.json`
- **Dynamic config** (model lists from OpenRouter API) is fetched at deploy time by Pulumi and stored in the `opencode-config-dir` ConfigMap

The init container merges them with `jq -s '.[0] * .[1]'` — ConfigMap wins on conflicts.

| Layer               | Where                                                         |
| ------------------- | ------------------------------------------------------------- |
| Static config       | `images/opencode/config/opencode.json`                        |
| Dynamic (ConfigMap) | `src/index.ts` → `opencode-config-dir`                        |
| Init merge logic    | `packages/opencode-router/src/pod-manager.ts` → `ensurePod()` |

## Related

- [homelab repo](https://github.com/mrsimpson/homelab) — the base cluster infrastructure
- [`@mrsimpson/homelab-core-components`](https://www.npmjs.com/package/@mrsimpson/homelab-core-components) — the published Pulumi component library used by this stack
- [opencode-cloudflare-operator](../packages/opencode-cloudflare-operator/) — the operator sidecar source code
- [opencode-router](../packages/opencode-router/) — the router source code
- [ADR-013: External App Deployment](https://github.com/mrsimpson/homelab/blob/main/docs/adr/013-external-app-deployment-with-published-packages-and-esc.md) — the architectural decision record explaining this approach
