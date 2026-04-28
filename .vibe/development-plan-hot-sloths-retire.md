# Development Plan: repo (hot-sloths-retire branch)

_Generated on 2026-04-27 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Fix the opencode web terminal (PTY) functionality in the containerized homelab deployment. The terminal fails to launch with a 500 error because the `bun-pty` native library (`librust_pty.so`) is not available at runtime in the container.

## Key Decisions

### Decision 1: Base Image Does Not Handle Native Libraries

**Date**: 2026-04-27  
**Context**: User asked how the base image handles PTY native libraries.  
**Finding**: The base image (`packages/opencode/Dockerfile`) does NOT handle native libraries. It simply copies the pre-compiled binary and expects it to be self-contained. The base image only installs `libgcc`, `libstdc++`, and `ripgrep`.

### Decision 2: Root Cause - Missing Native Library at Runtime

**Date**: 2026-04-27  
**Context**: PTY terminal fails with 500 error in homelab deployment.  
**Root Cause**: The `bun-pty` package requires `librust_pty.so` (native Rust library). While `bun build --compile` should embed this via `require()` static analysis, the library is not available at runtime in the container. The fallback mechanism in `bun-pty` looks for the library in filesystem paths that don't exist in the container.

### Decision 3: Fix Strategy for Homelab Image

**Date**: 2026-04-27  
**Context**: Need to fix the homelab Dockerfile to support PTY terminals.  
**Decision**: Modify `deployment/homelab/images/opencode/Dockerfile` to:

1. Extract `librust_pty.so` from the `bun-pty` npm package (or install the package)
2. Copy the library to `/usr/local/lib/bun-pty/librust_pty.so`
3. Set `BUN_PTY_LIB=/usr/local/lib/bun-pty/librust_pty.so` environment variable
4. Ensure `libgcc` and `libstdc++` are available (they should be inherited from base image)

### Decision 4: Analyze Differences Between Base and Homelab Images

**Date**: 2026-04-28  
**Context**: User asked to analyze the difference between the images to understand what's being lost.  
**Findings**:

| Aspect                            | Base Image   | Homelab Image              | Potential Issue                                |
| --------------------------------- | ------------ | -------------------------- | ---------------------------------------------- |
| Base                              | alpine       | ghcr.io/anomalyco/opencode | Inherits correctly                             |
| User                              | root         | opencode (UID 1000)        | **Binary may extract libs to unwritable path** |
| HOME                              | (not set)    | /home/opencode             | Library extraction might need $HOME writable   |
| BUN_RUNTIME_TRANSPILER_CACHE_PATH | 0            | 0 (inherited)              | OK                                             |
| Entrypoint                        | ["opencode"] | ["opencode"] (inherited)   | OK                                             |

**Root Cause Hypothesis**: The pre-compiled binary embeds `librust_pty.so` via `require()`. When Bun runs the binary, it may need to extract the library to a temp location (like `/tmp` or `$HOME/.bun`). The `opencode` user (UID 1000) might not have write permissions to this path.

**Solution**: Ensure the `opencode` user can write to the extraction path by:

1. Creating `/home/opencode/.bun` directory with proper permissions
2. Or setting `TMPDIR` to a writable location
3. Or explicitly setting `BUN_PTY_LIB` to point to a known library path (more reliable)

## Notes

### How bun-pty Loads Native Libraries

From `node_modules/bun-pty/src/terminal.ts`, the loading order is:

1. Check `BUN_PTY_LIB` environment variable
2. Try `require()` with platform-specific path (should be embedded by Bun compiler)
3. Fallback to filesystem paths relative to the module

### Base Image Analysis

- File: `packages/opencode/Dockerfile`
- Alpine Linux base (musl libc)
- Only installs: `libgcc`, `libstdc++`, `ripgrep`
- Copies pre-compiled binary from `dist/` directory
- Does NOT handle native library dependencies

### Relevant Native Library

- Library: `librust_pty.so` (for x64 Linux)
- Location in repo: `node_modules/bun-pty/rust-pty/target/release/librust_pty.so`
- Dependencies: musl libc, libgcc, libstdc++
- Size: ~610KB

## Explore

### Tasks

- [ ] _Tasks will be added as they are identified_

### Completed

- [x] Created development plan file

## Plan

### Tasks

- [ ] **Task 1**: Modify `deployment/homelab/images/opencode/Dockerfile` to include `librust_pty.so`
  - Copy `librust_pty.so` from the `bun-pty` package to the image
  - Set `BUN_PTY_LIB` environment variable
  - Verify library dependencies with `ldd`

- [ ] **Task 2**: Test the fix locally (if possible)
  - Build the homelab image
  - Run a container and verify PTY functionality works
  - Check logs for any errors

- [ ] **Task 3**: Consider if base image (`packages/opencode/Dockerfile`) also needs fixing
  - The base image is used for non-homelab deployments
  - May need the same fix if PTY is expected to work in all deployments

### Completed

- [x] Analyzed base image Dockerfile - does NOT handle native libraries
- [x] Identified root cause: `librust_pty.so` not available at runtime
- [x] Documented bun-pty loading mechanism and fallback paths
- [x] Determined fix strategy: copy native lib + set BUN_PTY_LIB env var

## Code

### Tasks

- [ ] **Task 2**: Verify the fix works (post-merge)
  - Build the homelab image
  - Test that PTY terminal functions correctly
  - Check that `BUN_PTY_LIB` is properly set in the container

### Completed

- [x] **Task 1**: Fix homelab Dockerfile to ensure PTY library is accessible
  - Added `npm install -g bun-pty@0.4.8` to get the native library
  - Copy `librust_pty.so` to `/usr/local/lib/bun-pty/librust_pty.so`
  - Set `BUN_PTY_LIB=/usr/local/lib/bun-pty/librust_pty.so` environment variable
  - Ensure `opencode` user can read the library (chmod 644)

## Commit

### Tasks

- [ ] Create commit with changes
- [ ] Push to remote branch
- [ ] Create Pull Request

### Completed

_None yet_

## Commit

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_None yet_

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
