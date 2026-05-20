# Development Plan: repo (fix/glob-tool-missing-ripgrep branch)

_Generated on 2026-05-20 by Vibe Feature MCP_
_Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)_

## Goal

Fix the glob tool not working in Docker containers spawned by the opencode router by ensuring ripgrep is installed in the container image.

## Key Decisions

- **Add ripgrep to homelab Dockerfile**: Instead of relying on the base opencode image to have ripgrep, we explicitly install it in the homelab Dockerfile. This ensures the dependency is always available regardless of which base image version is used.
- **Minimal fix**: The change is a single-line addition to the Dockerfile's `apk add` command, minimizing blast radius.

## Notes

- The glob tool (`packages/opencode/src/tool/glob.ts`) uses ripgrep (`rg`) via the Ripgrep service (`packages/opencode/src/file/ripgrep.ts`) for file finding.
- The ripgrep service first checks if `rg` is in the system PATH via `which("rg")`, then falls back to downloading from GitHub releases.
- The opencode Dockerfile (`packages/opencode/Dockerfile`) already installs ripgrep, but the homelab Dockerfile extends from a pre-built image (`ghcr.io/anomalyco/opencode:${BASE_VERSION}`) that may not have ripgrep if it was published before the ripgrep installation was added.
- The fix adds `ripgrep` to the `apk add` command in the homelab Dockerfile.

## Reproduce

### Tasks

- [x] Investigated the glob tool implementation and its dependency on ripgrep
- [x] Traced the Docker image build chain (homelab → opencode base → Alpine)
- [x] Identified that ripgrep may not be present in older base images

### Completed

- [x] Created development plan file

## Analyze

### Tasks

- [x] Root cause: ripgrep not explicitly installed in homelab Dockerfile

### Completed

_None yet_

## Fix

### Tasks

- [x] Added ripgrep to homelab Dockerfile apk add command

### Completed

_None yet_

## Verify

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_None yet_

## Finalize

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_None yet_

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
