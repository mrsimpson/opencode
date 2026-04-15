# Development Plan: homelab (default branch)

_Generated on 2026-04-15 by Vibe Feature MCP_
_Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)_

## Goal

Expose two OpenRouter provider entries in opencode so users can choose between:

1. **`openrouter-free`** — a custom provider populated dynamically at deploy time with all free models (no cost, rate-limited), backed by a dedicated zero-balance key.
2. **`openrouter`** — the native provider with a curated set of high-quality paid coding models, backed by a separate paid-balance key.

Both model lists are generated dynamically at `pulumi up` time by fetching the OpenRouter API, so they stay current without manual maintenance.

## Key Decisions

- **Two separate OpenRouter providers, two separate API keys**:
  - `openrouter-free` — custom `@ai-sdk/openai-compatible` provider pointing at `https://openrouter.ai/api/v1`, using `OPENROUTER_FREE_API_KEY` (zero balance). Contains all free models (price=0).
  - `openrouter` — native built-in provider, using `OPENROUTER_API_KEY` (paid balance). Contains a curated list of high-quality coding models in the $0.10–$5/M token range.
- **Why a custom provider for free?**: The native `openrouter` provider can only have one API key. Keeping free models on a separate provider with a zero-balance key prevents any accidental spend if a free model ID is later repriced.
- **Dynamic fetch at deploy time**: Both model lists are fetched from `https://openrouter.ai/api/v1/models` during `pulumi up`. Free = filter `prompt=="0" && completion=="0"`. Paid = curated fixed list of IDs validated against the live API.
- **Free model exclusions**: Strip non-chat/non-coding entries: `openrouter/free`, `openrouter/elephant-alpha`, `google/lyria-3-*`, any ID containing `guard`.
- **Paid model selection**: Curated list — not auto-generated from price range (too many irrelevant models). IDs are hardcoded in `src/index.ts`; the fetch validates they still exist and removes any that have disappeared.
- **Two new Pulumi secrets**: `openrouterApiKey` (paid, `OPENROUTER_API_KEY`) and `openrouterFreeApiKey` (free, `OPENROUTER_FREE_API_KEY`). Both added to `opencode-api-keys` Kubernetes Secret and mounted into session pods.
- **Config shape**: `openrouter-free` uses `provider.openrouter-free.options.apiKey` pointing to `OPENROUTER_FREE_API_KEY` env var. `openrouter` uses its native env-var pickup of `OPENROUTER_API_KEY` with an explicit `models` allowlist.
- **Two config locations updated**: `images/opencode/config/opencode.json` (static baked snapshot) and the Pulumi ConfigMap in `src/index.ts` (live, overrides the baked file at runtime).
- **`openrouter-free` in opencode.json config**: Uses `npm: "@ai-sdk/openai-compatible"` and `options.baseURL: "https://openrouter.ai/api/v1"` and `options.apiKey` pointing to the env var.

## Notes

### Curated paid coding models (validated as of 2026-04-15)

Selected for: strong coding reputation, meaningful context window (≥64k), price in $0.10–$5/M input tokens range. Excludes audio, image-gen, search, roleplay, and safety models.

| Model ID                        | Name                         | Context | Input $/M |
| ------------------------------- | ---------------------------- | ------- | --------- |
| `anthropic/claude-sonnet-4.6`   | Claude Sonnet 4.6            | 1M      | $3.00     |
| `anthropic/claude-sonnet-4.5`   | Claude Sonnet 4.5            | 1M      | $3.00     |
| `anthropic/claude-3.7-sonnet`   | Claude 3.7 Sonnet            | 200k    | $3.00     |
| `anthropic/claude-haiku-4.5`    | Claude Haiku 4.5             | 200k    | $1.00     |
| `openai/gpt-5.4`                | GPT-5.4                      | 1M      | $2.50     |
| `openai/gpt-5.3-codex`          | GPT-5.3-Codex                | 400k    | $1.75     |
| `openai/gpt-5.1-codex`          | GPT-5.1-Codex                | 400k    | $1.25     |
| `openai/o4-mini`                | o4 Mini                      | 200k    | $1.10     |
| `openai/gpt-4.1`                | GPT-4.1                      | 1M      | $2.00     |
| `google/gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview       | 1M      | $2.00     |
| `google/gemini-2.5-pro`         | Gemini 2.5 Pro               | 1M      | $1.25     |
| `google/gemini-3-flash-preview` | Gemini 3 Flash Preview       | 1M      | $0.50     |
| `google/gemini-2.5-flash`       | Gemini 2.5 Flash             | 1M      | $0.30     |
| `deepseek/deepseek-r1-0528`     | DeepSeek R1 0528             | 163k    | $0.50     |
| `deepseek/deepseek-v3.2`        | DeepSeek V3.2                | 163k    | $0.26     |
| `qwen/qwen3-coder`              | Qwen3 Coder 480B A35B (paid) | 262k    | $0.22     |
| `qwen/qwen3-coder-plus`         | Qwen3 Coder Plus             | 1M      | $0.65     |
| `mistralai/devstral-medium`     | Devstral Medium              | 131k    | $0.40     |
| `mistralai/codestral-2508`      | Codestral 2508               | 256k    | $0.30     |
| `moonshotai/kimi-k2`            | Kimi K2                      | 131k    | $0.57     |

### Currently free models on OpenRouter (as of 2026-04-15)

Fetched from `https://openrouter.ai/api/v1/models`, filtered `pricing.prompt == "0" && pricing.completion == "0"`, exclusions applied:

`arcee-ai/trinity-large-preview:free`, `cognitivecomputations/dolphin-mistral-24b-venice-edition:free`, `google/gemma-3-12b-it:free`, `google/gemma-3-27b-it:free`, `google/gemma-3-4b-it:free`, `google/gemma-3n-e2b-it:free`, `google/gemma-3n-e4b-it:free`, `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`, `liquid/lfm-2.5-1.2b-instruct:free`, `liquid/lfm-2.5-1.2b-thinking:free`, `meta-llama/llama-3.2-3b-instruct:free`, `meta-llama/llama-3.3-70b-instruct:free`, `minimax/minimax-m2.5:free`, `nousresearch/hermes-3-llama-3.1-405b:free`, `nvidia/nemotron-3-nano-30b-a3b:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-nano-12b-v2-vl:free`, `nvidia/nemotron-nano-9b-v2:free`, `openai/gpt-oss-120b:free`, `openai/gpt-oss-20b:free`, `qwen/qwen3-coder:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `z-ai/glm-4.5-air:free`

### Config shape for opencode.json

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "anthropic/claude-sonnet-4.6": {},
        "deepseek/deepseek-v3.2": {}
      }
    },
    "openrouter-free": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "name": "openrouter-free",
        "baseURL": "https://openrouter.ai/api/v1",
        "apiKey": "${OPENROUTER_FREE_API_KEY}"
      },
      "models": {
        "qwen/qwen3-coder:free": {},
        "google/gemma-4-31b-it:free": {}
      }
    }
  }
}
```

### Pulumi dynamic fetch approach

Two helper functions in `src/index.ts`:

```typescript
// Fetch all free models dynamically
async function fetchFreeModels(): Promise<Record<string, object>> {
  const res = await fetch("https://openrouter.ai/api/v1/models")
  const json = (await res.json()) as { data: Array<{ id: string; pricing: { prompt: string; completion: string } }> }
  const excluded = new Set(["openrouter/free", "openrouter/elephant-alpha"])
  return Object.fromEntries(
    json.data
      .filter((m) => m.pricing.prompt === "0" && m.pricing.completion === "0")
      .filter((m) => !excluded.has(m.id) && !m.id.startsWith("google/lyria-") && !m.id.includes("guard"))
      .map((m) => [m.id, {}]),
  )
}

// Validate curated paid list against live API, drop any that have been removed
const PAID_MODELS = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-3.7-sonnet",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.1-codex",
  "openai/o4-mini",
  "openai/gpt-4.1",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-pro",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-r1-0528",
  "deepseek/deepseek-v3.2",
  "qwen/qwen3-coder",
  "qwen/qwen3-coder-plus",
  "mistralai/devstral-medium",
  "mistralai/codestral-2508",
  "moonshotai/kimi-k2",
]

async function fetchPaidModels(): Promise<Record<string, object>> {
  const res = await fetch("https://openrouter.ai/api/v1/models")
  const json = (await res.json()) as { data: Array<{ id: string }> }
  const live = new Set(json.data.map((m) => m.id))
  return Object.fromEntries(PAID_MODELS.filter((id) => live.has(id)).map((id) => [id, {}]))
}
```

## Explore

<!-- beads-phase-id: opencode-1.1 -->

### Tasks

_Tasks managed via `bd` CLI_

## Plan

<!-- beads-phase-id: opencode-1.2 -->

### Tasks

_Tasks managed via `bd` CLI_

## Code

<!-- beads-phase-id: opencode-1.3 -->

### Tasks

#### 1. Add both OpenRouter secrets to Pulumi and mount into `opencode-api-keys`

In `src/index.ts`:

- `const openrouterApiKey = cfg.requireSecret("openrouterApiKey")`
- `const openrouterFreeApiKey = cfg.requireSecret("openrouterFreeApiKey")`
- Add both to `apiKeysSecret.stringData`: `OPENROUTER_API_KEY` and `OPENROUTER_FREE_API_KEY`

#### 2. Add `fetchFreeModels()` and `fetchPaidModels()` helpers in `src/index.ts`

- Implement both functions as described in Notes
- `PAID_MODELS` is a top-level const array of curated IDs
- Both return `Promise<Record<string, object>>`

#### 3. Update Pulumi ConfigMap with both provider entries

In `src/index.ts`:

- Await both fetch calls before constructing the ConfigMap
- `opencode.json` gets a `provider` object with:
  - `openrouter`: `{ models: paidModels }` (native provider uses `OPENROUTER_API_KEY` env var automatically)
  - `openrouter-free`: `{ npm: "@ai-sdk/openai-compatible", options: { name: "openrouter-free", baseURL: "https://openrouter.ai/api/v1", apiKey: "${OPENROUTER_FREE_API_KEY}" }, models: freeModels }`

#### 4. Update `images/opencode/config/opencode.json` with static snapshot

- Add `provider.openrouter.models` with the curated paid list from Notes
- Add `provider.openrouter-free` with the static free list from Notes
- Fallback only — Pulumi ConfigMap mount overrides at runtime

## Commit

<!-- beads-phase-id: opencode-1.4 -->

### Tasks

_Tasks managed via `bd` CLI_

---

_This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management._
