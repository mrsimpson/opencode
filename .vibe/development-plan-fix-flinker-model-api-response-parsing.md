# Development Plan: opencode (fix/flinker-model-api-response-parsing branch)

*Generated on 2026-05-18 by Vibe Feature MCP*
*Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)*

## Goal
Fix the `fetchFlinkerModels()` function in `deployment/homelab/src/index.ts` which was parsing the OpenAI-compatible `/v1/models` API response with the wrong field names, causing flinker (Qwen) models to never appear in the generated ConfigMap.

## Key Decisions
- **Root cause**: The OpenAI-compatible `/v1/models` endpoint returns `{ data: [{ id: string, status: { value, args } }] }`, but the code was reading `data.models[].name`. This caused `fetchFlinkerModels()` to always return `{}`.
- **Fix approach**: Updated the type cast and parsing to use `data.data` and `m.id`. Used `flatMap` + null-filter pattern to both parse and filter in one pass.
- **Richer metadata**: Flinker's response includes `status.args` (the llama-server CLI args), which lets us extract:
  - `--ctx-size` → `limit.context` (and `limit.output` capped at 32768)
  - `--embeddings` flag → filter out embedding-only models (e.g. `bge-m3`)
  - Missing `--model`/`--hf-repo` → filter out placeholder entries (e.g. `default`)
  - `status.value === "loaded"` → label suffix `"(local, loaded)"` vs `"(local)"`
  - `tool_call: true` → all exposed flinker models support tool calling (llama.cpp jinja mode)
- **No config changes needed**: The flinker provider block (`api: "http://flinker:8080/v1"`) was already correct.

## Notes
- Type check (`tsc --noEmit`) passes cleanly.
- All 22 existing tests pass.
- Live flinker output: `bge-m3` and `default` are filtered out; `qwen3.6-35b-a3b` gets ctx 262144/output 32768; `ggml-org/gpt-oss-120b-GGUF` gets no limit (not configured with `--ctx-size`).

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

