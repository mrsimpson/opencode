import type { StoredMessage, SessionProgress } from "./progress-types.js"

// STUB — returns wrong values so tests fail on assertions
export const messageStore = {
  setTitle(_hash: string, _title: string): void {
    // stub: no-op
  },
  addMessage(_hash: string, _msg: StoredMessage): void {
    // stub: no-op
  },
  get(_hash: string): SessionProgress | undefined {
    // stub: always returns undefined (wrong for most tests)
    return undefined
  },
  delete(_hash: string): void {
    // stub: no-op
  },
}
