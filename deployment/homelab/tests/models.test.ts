import { describe, it, expect } from "vitest"
import { filterFreeModels, filterPaidModels } from "../src/models"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function model(id: string, prompt = "3", completion = "15") {
  return { id, pricing: { prompt, completion }, supported_parameters: [] as string[] }
}
function free(id: string) {
  return { id, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] }
}
function paid(id: string) {
  return { id, pricing: { prompt: "1", completion: "5" }, supported_parameters: ["tools"] }
}

// ---------------------------------------------------------------------------
// filterFreeModels
// ---------------------------------------------------------------------------

describe("filterFreeModels", () => {
  it("keeps models with prompt=0 and completion=0", () => {
    const result = filterFreeModels([free("a/model-1:free"), free("b/model-2:free"), paid("c/paid")])
    expect(Object.keys(result)).toHaveLength(2)
  })

  it("drops models that have non-zero pricing", () => {
    expect(Object.keys(filterFreeModels([free("a/free"), paid("b/paid")]))).toHaveLength(1)
  })

  it("drops the openrouter/free catch-all entry", () => {
    expect(Object.keys(filterFreeModels([free("openrouter/free"), free("a/real:free")]))).toHaveLength(1)
  })

  it("drops openrouter/elephant-alpha", () => {
    expect(Object.keys(filterFreeModels([free("openrouter/elephant-alpha"), free("a/real:free")]))).toHaveLength(1)
  })

  it("drops models whose id contains 'guard'", () => {
    expect(Object.keys(filterFreeModels([free("meta/llama-guard-3:free"), free("a/safe:free")]))).toHaveLength(1)
  })

  it("drops models starting with google/lyria-", () => {
    expect(Object.keys(filterFreeModels([free("google/lyria-3-preview"), free("a/real:free")]))).toHaveLength(1)
  })

  it("returns empty object when all models are filtered out", () => {
    expect(
      filterFreeModels([
        free("openrouter/free"),
        free("openrouter/elephant-alpha"),
        free("meta/guard"),
        free("google/lyria-3"),
        paid("x/paid"),
      ]),
    ).toEqual({})
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
  it("keeps only non-free models", () => {
    const result = filterPaidModels([paid("a/paid"), free("b/free"), paid("c/paid")])
    expect(Object.keys(result)).toHaveLength(2)
    expect(Object.keys(result)).not.toContain("b/free")
  })

  it("returns empty object when input is empty", () => {
    expect(filterPaidModels([])).toEqual({})
  })

  it("returns empty object when all models are free", () => {
    expect(filterPaidModels([free("a/free"), free("b/free")])).toEqual({})
  })

  it("respects the PAID_LIMIT cap", () => {
    // Build a list larger than PAID_LIMIT (20)
    const many = Array.from({ length: 30 }, (_, i) => paid(`provider/model-${i}`))
    expect(Object.keys(filterPaidModels(many)).length).toBeLessThanOrEqual(20)
  })

  it("preserves input ordering (popularity order from API)", () => {
    const input = [paid("a/first"), paid("b/second"), paid("c/third")]
    expect(Object.keys(filterPaidModels(input))).toEqual(["a/first", "b/second", "c/third"])
  })

  it("maps each kept model to an empty object value", () => {
    const result = filterPaidModels([paid("a/p1"), paid("b/p2")])
    for (const v of Object.values(result)) expect(v).toEqual({})
  })
})
