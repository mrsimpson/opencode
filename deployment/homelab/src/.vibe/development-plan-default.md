# Development Plan: src (default branch)

_Generated on 2026-04-16 by Vibe Feature MCP_
_Workflow: [minor](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/minor)_

## Goal

Improve opencode configuration management in the homelab deployment by separating static configuration (baked into image) from dynamic configuration (model lists from OpenRouter API at deploy time), with proper deep merging.

## Key Decisions

- **Architecture**: Bake static config (agents, skills, plugins, MCP) in image; use ConfigMap only for dynamic model lists; deep merge at init container startup
- **Merge tool**: `jq -s '.[0] * .[1]'` for recursive deep merge where ConfigMap wins
- **Session pod flow**: Init container copies baked config `/etc/opencode-defaults/` → `/home/opencode/.config/opencode/`, then merges ConfigMap, then clones git repo
- **Two model types**: `openrouter` (paid, top 20) and `openrouter-free` (free, filtered by $0 pricing)

## Notes

- Documentation created at `.vibe/docs/opencode-config.md` with architecture diagram, key files, and merge behavior

## Explore

### Completed

- [x] Created development plan file

## Implement

### Completed

- [x] Dockerfile: Added `jq` package for deep merge functionality
- [x] Pulumi ConfigMap: Simplified to contain only dynamic model overrides
- [x] Init container: Updated `pod-manager.ts` to merge baked config with ConfigMap using `jq` deep merge
- [x] Removed redundant error handler in `pod-manager.ts` (duplicate `.catch()`)

## Finalize

### Completed

- [x] Code cleanup: removed duplicate error handler in pod-manager.ts
- [x] Documentation: added "Session pod configuration" section to `README.md`
- [x] Removed unused `code:anthropicApiKey` from index.ts, Pulumi.yaml, Pulumi.dev.yaml, README.md

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
