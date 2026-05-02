import type { StoredMessage, SessionProgress } from "./progress-types.js"

const store = new Map<string, SessionProgress>()

export const messageStore = {
  setTitle(hash: string, title: string): void {
    const existing = store.get(hash) ?? { messages: [] }
    store.set(hash, { ...existing, title })
  },
  addMessage(hash: string, msg: StoredMessage): void {
    const existing = store.get(hash) ?? { messages: [] }
    // dedup by partID
    if (existing.messages.some((m) => m.partID === msg.partID)) return
    store.set(hash, { ...existing, messages: [...existing.messages, msg] })
  },
  get(hash: string): SessionProgress | undefined {
    return store.get(hash)
  },
  delete(hash: string): void {
    store.delete(hash)
  },
}
