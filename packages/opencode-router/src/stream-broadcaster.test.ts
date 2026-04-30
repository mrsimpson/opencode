import { describe, it, expect, mock } from "bun:test"
import { createBroadcaster } from "./stream-broadcaster.js"

describe("createBroadcaster", () => {
  it("emit calls all current subscribers", () => {
    const broadcaster = createBroadcaster<number>()
    const listener = mock((_v: number) => {})
    broadcaster.subscribe(listener)
    broadcaster.emit(42)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(42)
  })

  it("subscribe returns an unsubscribe function that stops future calls", () => {
    const broadcaster = createBroadcaster<string>()
    const listener = mock((_v: string) => {})
    const unsubscribe = broadcaster.subscribe(listener)
    broadcaster.emit("first")
    unsubscribe()
    broadcaster.emit("second")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith("first")
  })

  it("multiple subscribers each receive emit", () => {
    const broadcaster = createBroadcaster<boolean>()
    const a = mock((_v: boolean) => {})
    const b = mock((_v: boolean) => {})
    broadcaster.subscribe(a)
    broadcaster.subscribe(b)
    broadcaster.emit(true)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("after unsubscribe, listener no longer receives emits", () => {
    const broadcaster = createBroadcaster<number>()
    const listener = mock((_v: number) => {})
    const unsubscribe = broadcaster.subscribe(listener)
    unsubscribe()
    broadcaster.emit(99)
    expect(listener).not.toHaveBeenCalled()
  })

  it("emit with no subscribers does nothing (no error)", () => {
    const broadcaster = createBroadcaster<string>()
    expect(() => broadcaster.emit("solo")).not.toThrow()
  })
})
