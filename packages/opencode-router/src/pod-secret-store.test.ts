import { describe, it, expect, beforeEach } from "bun:test"
import { podSecretStore } from "./pod-secret-store.js"

beforeEach(() => {
  podSecretStore.delete("hash-a")
  podSecretStore.delete("hash-b")
})

describe("podSecretStore.generate", () => {
  it("returns a 64-char hex string", () => {
    const secret = podSecretStore.generate("hash-a")
    expect(secret).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(secret)).toBe(true)
  })

  it("stores the secret so get returns it", () => {
    const secret = podSecretStore.generate("hash-a")
    expect(podSecretStore.get("hash-a")).toBe(secret)
  })

  it("regenerates — second call replaces old secret", () => {
    const first = podSecretStore.generate("hash-a")
    const second = podSecretStore.generate("hash-a")
    // The stored value must be the latest one
    expect(podSecretStore.get("hash-a")).toBe(second)
    // The two secrets should almost certainly differ (random)
    // We cannot guarantee uniqueness but we can verify second is a valid hex string
    expect(/^[0-9a-f]{64}$/.test(second)).toBe(true)
    // After regeneration, first is no longer the stored value
    expect(podSecretStore.get("hash-a")).not.toBe(first)
  })
})

describe("podSecretStore.get", () => {
  it("returns undefined for unknown hash", () => {
    expect(podSecretStore.get("no-such-hash")).toBeUndefined()
  })
})

describe("podSecretStore.delete", () => {
  it("removes the entry", () => {
    podSecretStore.generate("hash-b")
    podSecretStore.delete("hash-b")
    expect(podSecretStore.get("hash-b")).toBeUndefined()
  })
})

describe("podSecretStore.verify", () => {
  it("returns true for correct secret", () => {
    const secret = podSecretStore.generate("hash-a")
    expect(podSecretStore.verify("hash-a", secret)).toBe(true)
  })

  it("returns false for wrong secret", () => {
    podSecretStore.generate("hash-a")
    expect(podSecretStore.verify("hash-a", "wrong")).toBe(false)
  })

  it("returns false for unknown hash", () => {
    expect(podSecretStore.verify("not-stored", "anything")).toBe(false)
  })
})
