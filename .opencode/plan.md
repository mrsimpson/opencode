# Per-User Secrets for Session Pods

## Goal

Allow users to supply their own secrets (API keys, tokens, etc.) when creating a session via the opencode router. These secrets are injected into the user's K8s Pod as environment variables — scoped per-session, not shared across users.

## Design

### Backend changes

1. **SessionKey interface** — add optional `secrets?: Record<string, string>` field
2. **POST /api/sessions** — accept a `secrets` field in the JSON body
3. **K8s Secret** — create/update a per-session Secret (`opencode-secrets-<hash>`) containing the user's env vars
4. **PVC annotation** — `opencode.ai/has-secrets` flag to track presence of per-session secrets for resume flow
5. **Pod envFrom** — conditionally reference the per-session Secret (new sessions or resumed sessions with existing secret)
6. **Cleanup** — delete the per-session Secret on `terminateSession`

### Frontend changes (Router App)

1. **Session input form** — add a collapsible "Environment Variables" section with key-value pair inputs
2. **API layer** — pass secrets through to POST /api/sessions

## Files to modify

- `packages/opencode-router/src/pod-manager.ts` — SessionKey, ensureSessionSecrets, ensurePod, terminateSession
- `packages/opencode-router/src/api.ts` — parse secrets from request body
- `packages/opencode-router-app/src/api.ts` — accept secrets in create functions
- `packages/opencode-router-app/src/session-input-bar.tsx` — secrets UI
- `packages/opencode-router-app/src/app.tsx` — wire secrets state
- `packages/opencode-router-app/src/i18n/en.ts` — add translation keys
