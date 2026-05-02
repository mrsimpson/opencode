import { describe, it, expect, beforeEach } from "bun:test"
import { messageStore } from "./message-store.js"
import type { StoredMessage } from "./progress-types.js"

const makeMsg = (partID: string): StoredMessage => ({
  partID,
  messageID: "msg-1",
  sessionID: "session-1",
  role: "user",
  text: "hello",
  time: 1000,
})

beforeEach(() => {
  messageStore.delete("hash-a")
  messageStore.delete("hash-b")
})

describe("messageStore.setTitle", () => {
  it("stores and retrieves title", () => {
    messageStore.setTitle("hash-a", "My Title")
    expect(messageStore.get("hash-a")?.title).toBe("My Title")
  })
})

describe("messageStore.addMessage", () => {
  it("stores messages", () => {
    messageStore.addMessage("hash-a", makeMsg("part-1"))
    expect(messageStore.get("hash-a")?.messages).toHaveLength(1)
  })

  it("deduplicates by partID — same partID twice stores only once", () => {
    messageStore.addMessage("hash-a", makeMsg("part-x"))
    messageStore.addMessage("hash-a", makeMsg("part-x"))
    expect(messageStore.get("hash-a")?.messages).toHaveLength(1)
  })

  it("stores two messages with different partIDs", () => {
    messageStore.addMessage("hash-a", makeMsg("part-1"))
    messageStore.addMessage("hash-a", makeMsg("part-2"))
    expect(messageStore.get("hash-a")?.messages).toHaveLength(2)
  })
})

describe("messageStore.get", () => {
  it("returns undefined for unknown hash", () => {
    expect(messageStore.get("unknown-hash")).toBeUndefined()
  })
})

describe("messageStore.delete", () => {
  it("removes the entry", () => {
    messageStore.setTitle("hash-b", "To Be Deleted")
    messageStore.delete("hash-b")
    expect(messageStore.get("hash-b")).toBeUndefined()
  })
})
