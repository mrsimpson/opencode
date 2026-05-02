import type { StoredMessage } from "./progress-types.js"

export function createBroadcaster<T>() {
  const listeners = new Set<(value: T) => void>()
  return {
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(value: T): void {
      for (const listener of listeners) listener(value)
    },
  }
}

/**
 * Fired whenever the session list may have changed (pod state transition,
 * session terminated, session resumed, last-activity update, title/message push).
 * The GET /api/sessions/stream SSE handler re-fetches and re-emits the snapshot.
 */
export const sessionsChangedBroadcaster = createBroadcaster<void>()

/**
 * Fired when a new message is stored for a session.
 * The GET /api/sessions/:hash/progress/stream SSE handler filters by hash.
 */
export const progressBroadcaster = createBroadcaster<{ hash: string; message: StoredMessage }>()
