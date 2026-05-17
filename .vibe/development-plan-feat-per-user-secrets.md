# Development Plan: Per-User Secrets for Session Pods

_Generated on 2026-05-17 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Allow users to maintain their own API keys that are automatically injected into all their sessions. Users set their secret once in settings, and it persists across sessions.

## Key Decisions

1. **User Secret Storage**: Each user has ONE K8s Secret (`opencode-user-<email-hash>`) - same pattern as GitHub token secret
2. **Auto-injection**: User's secret is automatically mounted to all their session pods (no per-session configuration needed)
3. **Simple UI**: Settings page to set/update user's secret (no complex per-session UI)
4. **No per-session secrets**: Removed - user's stored secret is used for all sessions
5. **API Design**:
   - `GET/POST/DELETE /api/user/secret` - manage user's stored secret
   - Session creation automatically uses user's stored secret
6. **Secret Key Name**: `USER_API_KEY` - the key stored in the K8s secret for user's API key
7. **Test Implementation**: Tests written following existing patterns from ensureGithubTokenSecret and githubSecretName

## Notes

- Current state: All users share the same API keys from `opencode-api-keys` K8s Secret
- GitHub token already uses per-user secret pattern (`opencode-github-<email-hash>`) - similar approach
- This feature mirrors that pattern for user API keys

## Explore

### Tasks

- [x] Understand router session creation flow (POST /api/sessions)
- [x] Review existing per-session secret pattern (GitHub token)
- [x] Examine router app session input form (SessionInputBar)
- [x] Check i18n setup for adding new translations
- [x] Review SessionKey interface and ensurePod function

### Completed

- [x] Created development plan file
- [x] Explored router API (api.ts) - POST /api/sessions accepts repoUrl, branch, sourceBranch, initialMessage
- [x] Explored pod-manager.ts - ensurePod creates K8s pods with envFrom from shared secret
- [x] Explored router-app - SessionInputBar component for session creation
- [x] Explored i18n - en.ts has translation keys, index.ts has interpolation

## Plan

### Tasks

#### Backend (opencode-router)

1. **User Secret K8s Resource**
   - Create function to get user's K8s Secret name: `opencode-user-<email-hash>`
   - Add function to ensureUserSecret(email, secret) - creates/updates user's K8s Secret
   - Add function to deleteUserSecret(email) - removes user's K8s Secret
   - Add function to getUserSecret(email) - retrieves user's stored secret (from K8s)

2. **Update Session Creation**
   - Modify ensurePod to mount user's secret via envFrom (if exists)
   - Use user's email hash to construct secret name

3. **Add API Endpoints**
   - `GET /api/user/secret` - returns whether user has a secret set (keys only, no values)
   - `POST /api/user/secret` - set/update user's secret
   - `DELETE /api/user/secret` - delete user's secret

#### Frontend (opencode-router-app)

4. **User Secret API**
   - Add getUserSecret(), setUserSecret(), deleteUserSecret() to api.ts

5. **Settings UI**
   - Add "API Keys" section in settings (or a dedicated secrets page)
   - Display current keys (masked) with option to update/delete
   - Add "Set API Key" form

6. **i18n**
   - Add translation keys for settings page

### Design Decisions

1. **Secret Name**: `opencode-user-<sha256(email).slice(0,12)}` - deterministic per user
2. **Storage**: K8s Secret (same pattern as GitHub token secret)
3. **Mount**: envFrom in pod spec - secret key becomes env var name
4. **UI**: Simple settings page - not tied to session creation
5. **No per-session override**: User's secret is always used (removes complexity)

### Edge Cases

- **User has no secret**: Session works but uses only shared org keys
- **Update secret**: Works for new sessions; existing pods need restart to pick up new secret
- **Secret keys**: Must be valid env var names (uppercase, alphanumeric, underscores)

### Completed

_None yet_

## Code

### Tasks

- [x] Write tests for pod-manager user secret functions (TDD red phase)
- [x] Write tests for API endpoints (TDD red phase)
- [x] Implement pod-manager functions (green phase)
  - `getUserSecretName(email)` - returns secret name
  - `ensureUserSecret(email, secret)` - creates/updates K8s secret
  - `deleteUserSecret(email)` - deletes user's K8s Secret
  - `getUserSecret(email)` - retrieves user's stored secret
- [x] Implement API endpoints (green phase)
  - `GET /api/user/secret` - returns `{ hasSecret: boolean }`
  - `POST /api/user/secret` - set/update user's secret
  - `DELETE /api/user/secret` - delete user's secret
- [x] Update ensurePod to mount user secret via envFrom
- [x] Update session creation to pass userSecret to pods
- [x] Update resumeSession to pass userSecret to pods
- [x] Implement frontend API functions (getUserSecret, setUserSecret, deleteUserSecret)
- [x] Implement settings UI in frontend with settings button and dialog
- [x] Add i18n translations for settings

### Completed

- Created tests in `pod-manager.test.ts` for getUserSecretName, ensureUserSecret, deleteUserSecret
- Created tests in `api.test.ts` for GET/POST/DELETE /api/user/secret
- Implemented backend: pod-manager.ts functions, api.ts endpoints
- Updated ensurePod/startSession/resumeSession to pass userSecret
- Frontend: api.ts functions, app.tsx settings UI, i18n/en.ts translations
- Built successfully - frontend builds, backend tests pass

## Commit

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_None yet_
