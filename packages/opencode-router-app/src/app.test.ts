import { describe, it, expect } from "bun:test"
import { computeIdleStatus, type IdleLabels } from "./session-utils"

const labels: IdleLabels = {
  stopsIn: (m) => `stops in ~${m}m`,
  stoppedOn: (d) => `stopped on ${d}`,
  stoppingSoon: "stopping soon",
}

describe("computeIdleStatus", () => {
  it("returns 'stops in ~Xm' for a running session active recently", () => {
    const now = new Date()
    const twoMinsAgo = new Date(now.getTime() - 2 * 60_000).toISOString()
    const result = computeIdleStatus("running", twoMinsAgo, 15, labels)
    expect(result.label).toBe("stops in ~13m")
    expect(result.stopsInMinutes).toBe(13)
  })

  it("returns 'stopping soon' for a running session past timeout", () => {
    const now = new Date()
    const twentyMinsAgo = new Date(now.getTime() - 20 * 60_000).toISOString()
    const result = computeIdleStatus("running", twentyMinsAgo, 15, labels)
    expect(result.label).toBe("stopping soon")
  })

  it("handles zero minutes since activity (just active)", () => {
    const result = computeIdleStatus("running", new Date().toISOString(), 15, labels)
    expect(result.stopsInMinutes).toBe(15)
    expect(result.label).toBe("stops in ~15m")
  })

  it("handles exactly at timeout boundary", () => {
    const now = new Date()
    const exactTimeout = new Date(now.getTime() - 15 * 60_000).toISOString()
    const result = computeIdleStatus("running", exactTimeout, 15, labels)
    // At exactly 15min: stopsInMinutes = 0, label "stops in ~0m"
    expect(result.stopsInMinutes).toBe(0)
  })

  it("returns 'stopped on <date>' for a stopped session regardless of timeout", () => {
    const past = new Date("2026-03-15T10:00:00Z").toISOString()
    const result = computeIdleStatus("stopped", past, 15, labels)
    expect(result.label).toMatch(/^stopped on /)
    expect(result.stopsInMinutes).toBeNull()
    expect(result.stoppedMinutesAgo).toBeNull()
  })

  it("creating state shows stops countdown same as running", () => {
    const now = new Date()
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60_000).toISOString()
    const result = computeIdleStatus("creating", fiveMinsAgo, 15, labels)
    expect(result.stopsInMinutes).toBe(10)
  })
})
