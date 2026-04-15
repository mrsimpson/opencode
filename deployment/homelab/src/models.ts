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

const API_BASE = "https://openrouter.ai/api/v1/models"

/**
 * Query that pre-filters to programming + tool-calling capable models,
 * sorted by popularity. Both free and paid lists derive from this.
 */
const QUERY = "categories=programming&supported_parameters=tools&order=most-popular"

/** How many of the most-popular paid models to expose. */
const PAID_LIMIT = 20

/**
 * From a list already filtered to programming+tools, keep only the free models
 * and strip known noise entries.
 */
export function filterFreeModels(models: RawModel[]): Record<string, object> {
  return Object.fromEntries(
    models
      .filter((m) => m.pricing.prompt === "0" && m.pricing.completion === "0")
      .filter((m) => !EXCLUDED.has(m.id) && !m.id.startsWith("google/lyria-") && !m.id.includes("guard"))
      .map((m) => [m.id, {}]),
  )
}

/**
 * From a list already filtered to programming+tools (popularity-ordered),
 * keep only paid models and take the top PAID_LIMIT.
 */
export function filterPaidModels(models: RawModel[]): Record<string, object> {
  return Object.fromEntries(
    models
      .filter((m) => m.pricing.prompt !== "0" || m.pricing.completion !== "0")
      .slice(0, PAID_LIMIT)
      .map((m) => [m.id, {}]),
  )
}

// ---------------------------------------------------------------------------
// Fetch helpers (called at Pulumi deploy time)
// ---------------------------------------------------------------------------

type ModelsResponse = { data: (RawModel & LiveModel)[] }

async function fetchModels(): Promise<(RawModel & LiveModel)[]> {
  const res = await fetch(`${API_BASE}?${QUERY}`)
  return ((await res.json()) as ModelsResponse).data
}

/** Fetch free programming models — no hardcoded IDs, fully dynamic. */
export async function fetchFreeModels(): Promise<Record<string, object>> {
  return filterFreeModels(await fetchModels())
}

/** Fetch top-${PAID_LIMIT} most-popular paid programming models — fully dynamic. */
export async function fetchPaidModels(): Promise<Record<string, object>> {
  return filterPaidModels(await fetchModels())
}
