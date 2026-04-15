// ---------------------------------------------------------------------------
// OpenRouter model list helpers
// Pure filter functions are exported for testing; fetch wrappers call them.
// ---------------------------------------------------------------------------

type RawModel = {
  id: string
  pricing: { prompt: string; completion: string }
  supported_parameters?: string[]
}
type LiveModel = { id: string }

const EXCLUDED = new Set(["openrouter/free", "openrouter/elephant-alpha"])

export const PAID_MODELS = [
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

/** Filter a raw model list down to the free subset, excluding noise entries. */
export function filterFreeModels(models: RawModel[]): Record<string, object> {
  return Object.fromEntries(
    models
      .filter((m) => m.pricing.prompt === "0" && m.pricing.completion === "0")
      .filter((m) => !EXCLUDED.has(m.id) && !m.id.startsWith("google/lyria-") && !m.id.includes("guard"))
      .filter((m) => m.supported_parameters?.includes("tools") ?? false)
      .map((m) => [m.id, {}]),
  )
}

/** Validate the curated paid list against a live model list; drop any absent. */
export function filterPaidModels(live: LiveModel[]): Record<string, object> {
  const ids = new Set(live.map((m) => m.id))
  return Object.fromEntries(PAID_MODELS.filter((id) => ids.has(id)).map((id) => [id, {}]))
}

// ---------------------------------------------------------------------------
// Fetch helpers (called at Pulumi deploy time)
// ---------------------------------------------------------------------------

type ModelsResponse = { data: (RawModel & LiveModel)[] }

async function fetchModels(): Promise<(RawModel & LiveModel)[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models")
  return ((await res.json()) as ModelsResponse).data
}

export async function fetchFreeModels(): Promise<Record<string, object>> {
  return filterFreeModels(await fetchModels())
}

export async function fetchPaidModels(): Promise<Record<string, object>> {
  return filterPaidModels(await fetchModels())
}
