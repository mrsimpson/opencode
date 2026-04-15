# GitHub Auth Inside opencode Session Pods

## Problem

The opencode router uses oauth2-proxy for GitHub OAuth authentication at the
ingress level. oauth2-proxy authenticates the user and forwards
`X-Auth-Request-Email` to the router. However, the GitHub OAuth access token is
never forwarded to the router and never injected into session pods.

Result: `git push`, fetching private repos, and the `gh` CLI all fail inside
pods — no credentials available.

## Solution

Pipeline of changes:

1. Configure oauth2-proxy with `--pass-access-token=true` → adds
   `X-Auth-Request-Token: <token>` to every forwarded request
2. Router extracts the token from that header
3. Router creates/updates a per-session K8s Secret
   `opencode-github-<hash>` containing `GITHUB_TOKEN=<token>`
4. Pod spec mounts that Secret via `envFrom` (init container + main container)
5. Init container configures git credential store from `$GITHUB_TOKEN` so all
   subsequent git operations are authenticated

## Secret lifecycle

| Event                              | Secret action                        |
|------------------------------------|--------------------------------------|
| POST /api/sessions (create)        | Created with current token           |
| POST /api/sessions/:hash/resume    | Patched with fresh token, pod re-created |
| Pod deleted by idle cleanup        | Secret preserved (pod gone, secret stays) |
| DELETE /api/sessions/:hash         | Secret deleted with pod + PVC        |

## Security

- Token NOT in pod spec → not visible to roles that can `get pods` but not
  `get secrets`
- Can be encrypted at rest if etcd EncryptionConfig is enabled
- Cluster admins can still read the Secret directly; accepted trade-off (same
  as any other secret in the namespace)
- GitHub OAuth tokens are long-lived (don't expire unless revoked), so the
  token in `.git-credentials` (on the PVC) stays valid across pod restarts

## Files to change

| File | Change |
|------|--------|
| `deployment/homelab/src/index.ts` | Add `--pass-access-token=true` to oauth2-proxy args; add `secrets` verbs to RBAC Role |
| `packages/opencode-router/src/index.ts` | Extract `X-Auth-Request-Token` / `X-Forwarded-Access-Token` header, pass to `handleApi` |
| `packages/opencode-router/src/api.ts` | Thread `githubToken` to `ensurePod` and `resumeSession` |
| `packages/opencode-router/src/pod-manager.ts` | `ensureGithubTokenSecret`, Secret `envFrom` in pod spec, git credential setup in init script, Secret cleanup in `terminateSession` |

## Implementation order (TDD, one agent per phase)

1. **Router token extraction** — `index.ts` + `api.ts` unit tests + implementation
2. **pod-manager Secret lifecycle** — unit tests (fake K8s client) + implementation
   - `ensureGithubTokenSecret(hash, token)` — create-or-patch Secret
   - `ensurePod` — mount Secret, add git credential init to script
   - `resumeSession` — accept + pass token, refresh Secret before pod creation
   - `terminateSession` — delete Secret alongside PVC
3. **Pulumi / RBAC** — add `secrets` verbs to Role; add `--pass-access-token=true` to oauth2-proxy

## Git credential setup (init container script addition)

```sh
# --- git credentials (before git phase) ---
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global credential.helper store
  printf 'https://oauth2:%s@github.com\n' "$GITHUB_TOKEN" \
    > /home/opencode/.git-credentials
fi
```

Written to `/home/opencode/.git-credentials` (PVC-backed) so it persists
across pod restarts and is picked up automatically by the main container.
