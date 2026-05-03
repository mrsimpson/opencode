const store = new Map<string, Set<number>>()

export const portStore = {
  set(hash: string, ports: Set<number>): void {
    store.set(hash, ports)
  },
  get(hash: string): number[] {
    return Array.from(store.get(hash) ?? []).sort((a, b) => a - b)
  },
  delete(hash: string): void {
    store.delete(hash)
  },
}
