import { describe, it, expect } from "vitest"
import { filterFreeModels, filterPaidModels, PAID_MODELS } from "../src/models"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function model(id: string, prompt = "3", completion = "15") {
  return { id, pricing: { prompt, completion } }
}
function free(id: string) {
  return model(id, "0", "0")
}

// ---------------------------------------------------------------------------
// filterFreeModels
// ---------------------------------------------------------------------------

describe("filterFreeModels", () => {
  it("keeps models with prompt=0 and completion=0", () => {
    const input = [free("a/model-1:free"), free("b/model-2:free"), model("c/paid")]
    const result = filterFreeModels(input)
    expect(Object.keys(result)).toHaveLength(2)
  })

  it("drops models that have non-zero pricing", () => {
    const input = [free("a/free"), model("b/paid", "1", "5")]
    expect(Object.keys(filterFreeModels(input))).toHaveLength(1)
  })

  it("drops the openrouter/free catch-all entry", () => {
    const input = [free("openrouter/free"), free("a/real:free")]
    expect(Object.keys(filterFreeModels(input))).toHaveLength(1)
  })

  it("drops openrouter/elephant-alpha", () => {
    const input = [free("openrouter/elephant-alpha"), free("a/real:free")]
    expect(Object.keys(filterFreeModels(input))).toHaveLength(1)
  })

  it("drops models whose id contains 'guard'", () => {
    const input = [free("meta/llama-guard-3:free"), free("a/safe:free")]
    expect(Object.keys(filterFreeModels(input))).toHaveLength(1)
  })

  it("drops models starting with google/lyria-", () => {
    const input = [free("google/lyria-3-preview"), free("a/real:free")]
    expect(Object.keys(filterFreeModels(input))).toHaveLength(1)
  })

  it("returns empty object when all models are filtered out", () => {
    const input = [
      free("openrouter/free"),
      free("openrouter/elephant-alpha"),
      free("meta/guard"),
      free("google/lyria-3"),
      model("x/paid"),
    ]
    expect(filterFreeModels(input)).toEqual({})
  })

  it("maps each kept model to an empty object value", () => {
    const result = filterFreeModels([free("a/model:free"), free("b/model:free")])
    for (const v of Object.values(result)) expect(v).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// filterPaidModels
// ---------------------------------------------------------------------------

describe("filterPaidModels", () => {
  it("returns only PAID_MODELS ids present in the live list", () => {
    // Give it all PAID_MODELS as live — expect all back
    const live = PAID_MODELS.map((id: string) => ({ id }))
    expect(Object.keys(filterPaidModels(live))).toHaveLength(PAID_MODELS.length)
  })

  it("silently drops PAID_MODELS ids not present in live list", () => {
    // Only first half available live
    const half = PAID_MODELS.slice(0, Math.floor(PAID_MODELS.length / 2))
    const live = half.map((id: string) => ({ id }))
    expect(Object.keys(filterPaidModels(live))).toHaveLength(half.length)
  })

  it("ignores live models that are not in PAID_MODELS", () => {
    const live = [{ id: "random/unknown-model-1" }, { id: "random/unknown-model-2" }]
    expect(filterPaidModels(live)).toEqual({})
  })

  it("returns empty object when live list is empty", () => {
    expect(filterPaidModels([])).toEqual({})
  })

  it("maps each kept model to an empty object value", () => {
    const live = PAID_MODELS.slice(0, 3).map((id: string) => ({ id }))
    const result = filterPaidModels(live)
    for (const v of Object.values(result)) expect(v).toEqual({})
  })

  it("preserves PAID_MODELS ordering in result keys", () => {
    // Shuffle live to verify output order matches PAID_MODELS order, not live order
    const shuffled = [...PAID_MODELS].reverse().map((id: string) => ({ id }))
    const result = Object.keys(filterPaidModels(shuffled))
    expect(result).toEqual(PAID_MODELS.filter((id: string) => shuffled.some((m) => m.id === id)))
  })
})

// ---------------------------------------------------------------------------
// PAID_MODELS const
// ---------------------------------------------------------------------------

describe("PAID_MODELS", () => {
  it("contains at least 10 curated model ids", () => {
    expect(PAID_MODELS.length).toBeGreaterThanOrEqual(10)
  })

  it("has no duplicate ids", () => {
    expect(new Set(PAID_MODELS).size).toBe(PAID_MODELS.length)
  })

  it("all entries are non-empty strings", () => {
    for (const id of PAID_MODELS) expect(typeof id).toBe("string")
    for (const id of PAID_MODELS) expect(id.length).toBeGreaterThan(0)
  })
})
