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
