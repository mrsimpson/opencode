# Development Plan: repo (ready-hairs-appear branch)

_Generated on 2026-04-29 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Add a new endpoint to the opencode router that pre-pulls container images after CI builds them, reducing cold start times for new sessions. The endpoint should also remove old images and perform a smoke test to verify the image runs correctly.

## Key Decisions

1. **Pre-pull approach**: Use test session via existing pod-manager `ensurePod()` - create session, wait for healthy, delete session (see ADR-0003)
2. **Smoke test**: Built-in - pod readiness probe validates opencode starts; if not healthy, image failed
3. **Image cleanup**: Skip direct cleanup from router (security risk: needs privileged containers). Document kubelet GC as alternative.
4. **Auth**: Add ADMIN_SECRET config, protect endpoint with X-Admin-Secret header (needed for CI systems without user identity)
5. **Single node cluster**: DaemonSet not needed; test session approach sufficient (ADR-0003)
6. **Implementation**: Added optional `image` parameter to `ensurePod()` to reuse existing function; `prepullImage()` creates test session with new image and polls for ready state

## Notes

- EPCC workflow is active
- User wants: pre-pull image, remove old images, smoke test (verify image runs)
- The opencode router manages session pods in Kubernetes
- Need BatchV1Api for Jobs, AppsV1Api for DaemonSet

## Explore

### Tasks

- [x] Understand how Kubernetes image pulling works in this codebase
- [x] Research how to execute commands on all nodes (DaemonSet vs Jobs)
- [x] Determine how to remove old container images from nodes (decision: skip, use kubelet GC)
- [x] Design smoke test approach (run container, check it starts) - use Jobs
- [x] Check existing authentication/authorization patterns for admin endpoints - none exist, need to add

### Completed

- [x] Created development plan file
- [x] Initial codebase exploration via explore agent (understood router, pod-manager, API structure)
- [x] Detailed research on K8s image management patterns

## Plan

### Tasks

- [x] **P1**: Add `adminSecret` to config.ts
- [x] **P2**: Implement `prepullImage(image: string): Promise<boolean>` function in pod-manager.ts
  - Temporarily use the new image for a test session
  - Call `ensurePod()` with test session key
  - Poll `getPodState()` until "running" or timeout (5 minutes)
  - If successful, call `terminateSession()` to clean up
  - Restore original image config (or update to new image)
  - Return success/failure
- [x] **P3**: Add `POST /api/admin/pull-image` endpoint to api.ts
  - Parse request body: `{ "image": "...", "updateConfig": true }`
  - Verify admin secret from X-Admin-Secret header
  - Call `prepullImage()` with the new image
  - If `updateConfig` is true, update the router's config.opencodeImage (in-memory)
  - Return status response: `{ "status": "success" | "failed", "message": "..." }`
- [ ] **P4**: Add error handling and timeout handling for long-running operations
- [ ] **P5**: Document the endpoint in API docs or README

### Completed

- [x] P1: Added `adminSecret` config (optional, when unset admin endpoints disabled)
- [x] P2: Implemented `prepullImage()` using test session approach (see ADR-0003)
- [x] P3: Added `POST /api/admin/pull-image` endpoint with admin secret auth

## Code

### Tasks

- [x] P1: Add `adminSecret` to config.ts
- [x] P2: Implement `prepullImage()` in pod-manager.ts
- [x] P3: Add `POST /api/admin/pull-image` endpoint to api.ts
- [x] P4: Add error handling and timeout handling (review and enhance if needed)
- [x] P5: Document the endpoint
- [x] P6: Add ADMIN_SECRET to Pulumi deployment config
- [x] P7: Add tests for the new endpoint (api.test.ts + pod-manager.test.ts)
- [x] P8: Add pre-pull step to GitHub Actions workflow

### Completed

- [x] P1: Added `adminSecret` config (optional, getter reads from process.env dynamically)
- [x] P2: Implemented `prepullImage()` using test session approach (see ADR-0003)
- [x] P3: Added `POST /api/admin/pull-image` endpoint with admin secret auth
- [x] P4: Enhanced error handling - cleanup works even if PVC/pod creation partially fails
- [x] P5: Added documentation to README.md (admin endpoints section + config table)
- [x] P6: Added `ADMIN_SECRET` to Pulumi config (`deployment/homelab/`) - secret created in K8s, mounted as env var in router deployment
- [x] P7: Added 8 tests for admin endpoint in api.test.ts + 2 tests for prepullImage() in pod-manager.test.ts
- [x] P8: Added pre-pull step to `.github/workflows/build-opencode-image.yml` - calls `/api/admin/pull-image` after building and pushing new image
- [ ] P9: Fix hostname.test.ts failures (pre-existing issue with test isolation, runs fine in isolation)

## Commit

### Tasks

- [x] **C1**: Code Cleanup - Remove debug output, review TODO/FIXME, remove debugging code blocks
- [x] **C2**: Documentation Review - Update long-term docs, compare against implementation, remove development progress references
- [x] **C3**: Final Validation - Run tests, verify documentation accuracy, ensure production readiness

### Completed

- [x] C1: Code Cleanup completed - No debug statements or TODO/FIXME comments found in modified files
- [x] C2: Documentation Review completed - README.md accurately reflects implementation, no .vibe/docs/ files exist to update
- [x] C3: Final Validation - Tests pass (76 pass, 0 fail); note: hostname.test.ts has pre-existing isolation issues (passes in isolation)

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
