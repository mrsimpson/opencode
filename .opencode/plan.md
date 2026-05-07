# Feature: Attach to Router Session from Local Client

## Context

Users want to connect a local OpenCode client to a session running in the router. This requires:

- Creating named routes like `attach-<sessionHash>` for these connections
- Providing password-based authentication to bypass OAuth for local clients
- Displaying attach details in the router-app UI

## Phase_1\_\_Router_Infrastructure [COMPLETED]

### 1.1 - Add attach port configuration ✓

**File**: `packages/opencode-router/src/config.ts`

- Added `attachPort` config (default: 4096) - Note: Using same port as opencodePort
- Added `attachRoutePrefix` config (default: "attach-")

### 1.2 - Generate and store attach passwords ✓

**File**: `packages/opencode-router/src/pod-manager.ts`

- Added annotation `opencode.ai/attach-password` to PVC metadata
- Added `generateAttachPassword()` function using `crypto.randomBytes(16).toString('hex')`
- Added `getOrCreateAttachPassword(hash)` function to retrieve or create password
- Added `getAttachUrl(hash)` function to build attach URL
- Extended `SessionInfo` interface to include `attachUrl` and `attachPassword`
- Updated `buildSessionInfo()` to populate attach fields
- Updated `ensurePVC()` to generate password on session creation
- Removed `req` parameter from `getAttachUrl()` - using `config.routerProto` instead

### 1.3 - Handle attach subdomain routing ✓

**File**: `packages/opencode-router/src/index.ts`

- Added `getAttachSessionHash(host)` function to extract hash from `attach-<hash>` subdomain
- Modified request handler to detect attach subdomain
- For attach routes: bypass email check, validate password from query param or header
- Proxy requests to session pod's opencodePort (same server, different auth)
- Updated WebSocket handler to support attach subdomain
- Fixed `validateAttachPassword()` to use `getOrCreateAttachPassword()` instead of direct k8sApi access

### 1.4 - Add attach API endpoints ✓

**File**: `packages/opencode-router/src/api.ts`

- Extended session info to include `attachUrl` and `attachPassword` (only for owner)
- Modified `listUserSessions()` to include attach info for session owner
- Added GET `/api/sessions/:hash/attach-info` endpoint for detailed attach info
- Added import for `getAttachUrl`

## Phase_2\_\_Pod_Configuration [COMPLETED]

### 2.1 - Attach port configuration ✓

**Implementation**: Separate HTTP server on `config.attachPort` (default 4096).

- A dedicated `attachServer` listens on a **different port** than the main API server
- The main server (port 3000) is behind oauth2-proxy; the attach server (port 4096) is NOT
- The attach server only handles `attach-<hash>` subdomain requests with password auth
- Returns 404 for any non-attach request on this port
- Proxies to the same pod port (opencodePort) via the same http-proxy instance

### 2.2 - Configure OpenCode server for attach [NOT REQUIRED]

**Finding**: OpenCode server doesn't need modifications because:

- The router handles the attach subdomain detection
- Password validation happens at the router level
- The router then proxies to the same OpenCode server port
- OpenCode doesn't need to know about "attach" mode - it just receives proxied requests

## Phase_3\_\_Router_App_UI [COMPLETED]

### 3.1 - Update API types ✓

**File**: `packages/opencode-router-app/src/api.ts`

- Added `attachUrl` and `attachPassword` to `Session` interface and schema

### 3.2 - Display attach info in session details ✓

**File**: `packages/opencode-router-app/src/session-item.tsx`

- Added attach URL and password display in expanded session detail panel
- Added copy buttons for URL and password
- Shows command format: `opencode attach --url <url> --password <password>`

## Phase_4\_\_Testing [PENDING]

### 4.1 - Unit tests needed

**Files**:

- `packages/opencode-router/src/pod-manager.test.ts` - Test password generation
- `packages/opencode-router/src/api.test.ts` - Test attach-info endpoint

Tests needed:

- Password generation and storage in PVC annotation
- Attach subdomain extraction (`getAttachSessionHash`)
- API endpoints return correct attach info
- Password validation logic

## Technical Decisions

1. **Password storage**: Store in PVC annotation (persists with session, not in pod)
2. **URL format**: `https://attach-<hash><routeSuffix>.<routerDomain>`
3. **Auth bypass**: Check for `?password=` query param or `X-Attach-Password` header on attach routes
4. **Port**: Using same port (4096) for both regular and attach connections
5. **Password generation**: Use `crypto.randomBytes(16).toString('hex')` for 32-char hex password

## Files Modified

1. `packages/opencode-router/src/config.ts` - Add attach config ✓
2. `packages/opencode-router/src/pod-manager.ts` - Password generation, attach URL, SessionInfo update ✓
3. `packages/opencode-router/src/index.ts` - Attach subdomain routing, auth bypass ✓
4. `packages/opencode-router/src/api.ts` - Attach info API, session info enrichment ✓
5. `packages/opencode-router-app/src/api.ts` - Update Session interface ✓
6. `packages/opencode-router-app/src/session-item.tsx` - Display attach info in UI ✓

## Implementation Summary

The attach functionality allows a local OpenCode client to connect to a router-managed session by:

1. **URL Format**: `https://attach-<hash><routeSuffix>.<routerDomain>`
   - Example: `https://attach-abc123def456-oc.no-panic.org`

2. **Authentication**: Password-based auth bypass
   - Password is auto-generated on session creation
   - Stored in PVC annotation: `opencode.ai/attach-password`
   - Pass via query param: `?password=<password>`
   - Or via header: `X-Attach-Password: <password>`

3. **Router Handling**:
   - Detects `attach-` prefix in subdomain
   - Validates password before proxying
   - Proxies to the same OpenCode server port

4. **UI Display**:
   - Shows attach URL and password in session details
   - Provides copy buttons for easy access
   - Shows command format for local client connection

## Next Steps

1. Add unit tests for new functionality
2. Test the full flow end-to-end in a Kubernetes environment
3. Document the attach feature for users
4. Consider adding password rotation in future (not in initial implementation)
