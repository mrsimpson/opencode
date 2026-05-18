# Development Plan: opencode (fix/flinker-model-api-response-parsing branch)

*Generated on 2026-05-18 by Vibe Feature MCP*
*Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)*

## Goal
Fix the `fetchFlinkerModels()` function in `deployment/homelab/src/index.ts` which was parsing the OpenAI-compatible `/v1/models` API response with the wrong field names, causing flinker (Qwen) models to never appear in the generated ConfigMap.

## Key Decisions
- **Root cause**: The OpenAI-compatible `/v1/models` endpoint returns `{ data: [{ id: string }] }`, but the code was reading `data.models` (field doesn't exist) and `m.name` (should be `m.id`). This caused `fetchFlinkerModels()` to always return `{}`.
- **Fix approach**: Updated the type cast and parsing to use `data.data` and `m.id`, matching the OpenAI spec. Used `?? []` as a safe fallback in case the field is missing. Replaced the imperative `for` loop + object mutation with a functional `Object.fromEntries` + `map` one-liner, consistent with the project style guide.
- **No config changes needed**: The flinker provider block in the ConfigMap (`api: "http://flinker:8080/v1"`) was already correct; only the model list population was broken.

## Notes
- Type check (`tsc --noEmit`) passes cleanly after the fix.
- All 22 existing tests pass.
- The fix is a single function in `deployment/homelab/src/index.ts` (lines 193–201).

## Explore
<!-- beads-phase-id: opencode-12.1 -->
### Tasks
<!-- beads-synced: 2026-05-18 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Implement
<!-- beads-phase-id: opencode-12.2 -->
### Tasks
<!-- beads-synced: 2026-05-18 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Finalize
<!-- beads-phase-id: opencode-12.3 -->
### Tasks
<!-- beads-synced: 2026-05-18 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

