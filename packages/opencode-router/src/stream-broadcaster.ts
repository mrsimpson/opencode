// STUB — subscribe/emit wired up incorrectly so tests fail on assertions
export function createBroadcaster<T>() {
  return {
    subscribe(_listener: (value: T) => void): () => void {
      // stub: never stores listener, returns no-op unsubscribe
      return () => {}
    },
    emit(_value: T): void {
      // stub: no-op — no listeners called
    },
  }
}
