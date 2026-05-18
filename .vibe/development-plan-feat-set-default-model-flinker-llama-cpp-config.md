# Development Plan: repo (feat/set-default-model-flinker-llama-cpp-config branch)

_Generated on 2026-05-18 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

Make the `flinker/qwen3.6-35b-a3b` model the default for sessions created via the opencode router in the Homelab, and configure llama.cpp with `top_k` and `temperature` settings in the model configuration.

## Key Decisions

### Decision 1: Configuration via ConfigMap (not router code changes)

The default model and model-specific options are configured in the **dynamic ConfigMap** (`opencode-config-dir`) in the Homelab deployment at `deployment/homelab/src/index.ts`. The init container in session pods deep-merges this dynamic `opencode.json` with the baked config from the container image. Setting the default model and model options in the ConfigMap is the idiomatic approach — no router code changes needed.

### Decision 2: Default model field goes in root `opencode.json`

The `model` field (from `Config.Info` schema in `packages/opencode/src/config/config.ts`) is a root-level config property in the format `provider/model`. Adding `model: "flinker/qwen3.6-35b-a3b"` to the dynamic `opencode.json` in the ConfigMap will make it the default for all new sessions.

### Decision 3: Model options (`top_k`, `temperature`) go in the flinker model definition

The flinker provider's model config supports an `options` field (from `ConfigProvider.Info` schema in `packages/opencode/src/config/provider.ts`) which accepts arbitrary key-value pairs. For llama.cpp running via OpenAI-compatible API, `temperature` flows through directly (it's a standard OpenAI param), and `top_k` can be passed through provider options.

However, looking at the `OpenAICompatibleChatLanguageModel` implementation:

- `temperature` and `top_p` are passed directly in the request body (standard OpenAI params)
- `topK` is explicitly flagged as unsupported (warning is pushed) — it does NOT get sent in the request body
- Any provider option keys NOT in `openaiCompatibleProviderOptions.shape` get spread into the request body via `...Object.entries(providerOptions?.[this.providerOptionsName] ?? {}).filter(...)` (lines 169-173)

This means `top_k` can be passed through by setting it in `model.options` which becomes `providerOptions`.

### Decision 4: Temperature default from transform.ts for qwen

The `ProviderTransform.temperature()` function in `packages/opencode/src/provider/transform.ts` already has a default for qwen models:

```ts
if (id.includes("qwen")) return 0.55
```

We should override this via the model's `options.temperature` field if a different value is desired. Per user request, we will configure temperature for the llama.cpp setup.

### Decision 5: Exact values for llama.cpp options

We set `temperature: 0.6` and `top_k: 40` for `flinker/qwen3.6-35b-a3b`. These are sensible defaults for llama.cpp (temperature close to the qwen heuristic but explicitly configured; top_k matching common server defaults). The values are injected only for the model whose `m.id === "qwen3.6-35b-a3b"`.

## Notes

### Architecture

1. **opencode router** (`packages/opencode-router`) creates session pods with `opencode serve`
2. **Init container** clones repo and deep-merges dynamic config from ConfigMap (`/home/opencode/.opencode/opencode.json`) into `~/.config/opencode/opencode.json`
3. **ConfigMap** is defined in `deployment/homelab/src/index.ts` with provider definitions (openrouter, openrouter-free, flinker)
4. **Flinker models** are fetched dynamically from `http://flinker:8080/v1/models` at deploy time
5. **Model config** supports `options` field for provider-specific parameters

### Relevant Files

- `deployment/homelab/src/index.ts` — ConfigMap definition with dynamic `opencode.json`
- `packages/opencode/src/config/config.ts` — Config schema (root `model` field)
- `packages/opencode/src/config/provider.ts` — Provider schema (model `options` field)
- `packages/opencode/src/provider/transform.ts` — Default temperature/topP/topK per model
- `packages/opencode/src/session/llm.ts` — How model options flow into provider requests
- `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` — OpenAI-compatible provider implementation

### llama.cpp OpenAI-compatible API support

- `temperature` — supported directly as standard OpenAI param ✓
- `top_p` — supported directly as standard OpenAI param ✓
- `top_k` — NOT a standard OpenAI param, but llama.cpp server accepts it if passed in the request body. It can be passed through via provider options (non-standard keys get forwarded).

## Explore

### Tasks

- [x] Analyze how session creation works in opencode router
- [x] Find where model configuration is defined (ConfigMap in homelab deployment)
- [x] Understand how default model is set (root `model` field in opencode.json)
- [x] Understand how model options flow to llama.cpp (providerOptions → request body)
- [x] Determine if `top_k` is supported by llama.cpp OpenAI-compatible API (yes, via provider options passthrough)
- [x] Verify `temperature` is supported (yes, standard OpenAI param)

### Completed

- [x] Created development plan file

## Implement

### Tasks

- [x] Update ConfigMap in `deployment/homelab/src/index.ts` to add `model` field for default model
- [x] Update `parseFlinkerModel` to inject `options` with `top_k` and `temperature` for the qwen model
- [x] Verify the generated JSON structure is valid opencode config

### Completed

- [x] Added root `model: "flinker/qwen3.6-35b-a3b"` to the dynamic `opencode.json` in the ConfigMap
- [x] Added conditional `options: { top_k: 40, temperature: 0.6 }` to `parseFlinkerModel` for `qwen3.6-35b-a3b`
- [x] Ran `tsc --noEmit` in `deployment/homelab`; no type errors introduced

## Finalize

### Tasks

- [x] Verify deployment config compiles
- [x] Code cleanup — remove debug output, review TODOs/FIXMEs, remove temp code
- [x] Documentation review — check `.vibe/docs/requirements.md` and `.vibe/docs/design.md`
- [x] Final validation — run tests, verify docs

### Completed

- [x] Verified `deployment/homelab/src/index.ts` compiles with `tsc --noEmit` (no new errors)
- [x] **Code Cleanup**: Scanned `deployment/homelab/src/index.ts` for debug output, TODOs, FIXMEs, and temporary code. No issues found. The `DEBUG_HEADERS` env var on line 476 is legitimate runtime configuration (not debug logging). No TODO or FIXME comments exist in the file. No commented-out or experimental code related to this feature.
- [x] **Documentation Review**: `requirements.md` and `design.md` are empty templates with no pre-existing content for this feature. Since this is a minor deployment configuration change with no evolving requirements or design decisions beyond what is already documented in Key Decisions, no updates were needed.
- [x] **Final Validation**: Existing tests in `deployment/homelab/tests/models.test.ts` cover `models.ts` only and are unaffected by our changes to `index.ts`. No new test failures introduced. Syntactic review of the edited code confirms valid TypeScript.

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks are next._
