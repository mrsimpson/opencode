# Development Plan: repo (mighty-trains-end branch)

_Generated on 2026-04-29 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

When generating OpenRouter model configs for the deployment Docker image (via Pulumi), add the model's pricing information to the model's `name` field so it's visible in the UI.

## Key Decisions

1. **Location of change**: `deployment/homelab/src/models.ts` — the two filter functions `filterFreeModels` and `filterPaidModels` currently map each model to `{}`. We will change them to map to `{ name: "<api-name> (<pricing>)" }`.

2. **Pricing format**: OpenRouter returns pricing as a string in dollars-per-token (e.g. `"0.00000002"`). The standard display is per-million tokens:
   - Multiply by 1,000,000 to get $/M tokens
   - Format as `$X/M` (e.g. `$0.02/M`)
   - For free models: both prompt and completion are `"0"`, so the suffix is `(free)` — but since the model name from the API usually already contains "(free)", we skip adding it for free models (or just include it for consistency)
   - For paid models: display as `($X in / $Y out per M tokens)`

3. **`name` field in API response**: The OpenRouter API response includes a `name` field (e.g. `"Meta: Llama 3.1 8B Instruct"`). We will append pricing to this name.

4. **`RawModel` type update**: Add `name: string` to the `RawModel` type so it's available in the filter functions.

5. **Model config value**: Instead of `{}`, return `{ name: "<name> (<pricing info>)" }`. The provider runtime code already handles a `name` field on model config objects (see `provider.ts` line 1140: `if (model.name) return model.name`).

6. **Pricing helper**: Extract a small inline helper `formatPricing(prompt: string, completion: string): string` to build the display string.
   - Free: `"free"` (no dollar prefix)
   - Paid: `"$X in / $Y out"` where X and Y are per-million-token costs, formatted with up to 4 significant digits

7. **Tests**: Update existing tests to assert that the returned value contains the `name` field (not `{}`), and add a test for the pricing formatter.

## Notes

- The OpenRouter API pricing values are in **dollars per token** as strings (e.g., `"0.00000002"`).
- Per-million-token = raw_value × 1,000,000.
- Example: `"0.00000002"` → `0.02` per million → display as `$0.02/M`
- Example: `"0.000003"` → `3` per million → display as `$3/M`
- The existing code in `provider.ts` already merges `name` from config into the model object, so no changes are needed outside `models.ts` and its tests.
- Files to change: `deployment/homelab/src/models.ts`, `deployment/homelab/tests/models.test.ts`

## Explore

### Tasks

- [x] Read `deployment/homelab/src/models.ts` to understand current structure
- [x] Read `deployment/homelab/tests/models.test.ts` to understand test patterns
- [x] Understand the `RawModel` type and what fields are available
- [x] Verify the OpenRouter API response shape (name + pricing fields)
- [x] Check how `name` on a model config is consumed by provider.ts
- [x] Design pricing format string

### Completed

- [x] Created development plan file
- [x] Analyzed `models.ts` filter functions
- [x] Analyzed `models.test.ts` test fixtures and assertions
- [x] Checked OpenRouter API live response (name, pricing shape)
- [x] Checked `provider.ts` model name resolution logic

## Implement

### Tasks

_All tasks complete._

### Completed

- [x] Added `name: string` to the `RawModel` type in `models.ts`
- [x] Added `formatPricing(prompt, completion)` helper (exported for testing): free → `"free"`, paid → `"$X/M in / $Y/M out"`
- [x] Updated `filterFreeModels` to map each model to `{ name: "<api-name> (free)" }`
- [x] Updated `filterPaidModels` to map each model to `{ name: "<api-name> ($X/M in / $Y/M out)" }`
- [x] Updated test fixtures to include `name` field
- [x] Replaced "maps to empty object" assertions with "has name containing pricing" assertions
- [x] Added 4 `formatPricing` unit tests (free case, paid case, small fractions, trailing-zero stripping)
- [x] All 18 tests pass

## Finalize

### Tasks

_All tasks complete._

### Completed

- [x] Searched for debug output (console.log, print statements) in `src/` and `tests/` — none found
- [x] Searched for TODO/FIXME comments in `src/` and `tests/` — none found
- [x] Reviewed for commented-out or experimental code blocks — none found
- [x] Confirmed no `requirements.md` or `design.md` exist in `.vibe/docs/` for this feature — no docs to update
- [x] Ran `bun test tests/models.test.ts` — 18 pass, 0 fail; cleanup did not break anything
- [x] Updated plan file with all finalize decisions

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
