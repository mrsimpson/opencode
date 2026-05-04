import crypto from "node:crypto"

const store = new Map<string, string>()

export const podSecretStore = {
  generate(hash: string): string {
    const secret = crypto.randomBytes(32).toString("hex")
    store.set(hash, secret)
    return secret
  },
  /** Restore a known secret (e.g. from pod annotation on startup) without regenerating. */
  restore(hash: string, secret: string): void {
    store.set(hash, secret)
  },
  get(hash: string): string | undefined {
    return store.get(hash)
  },
  delete(hash: string): void {
    store.delete(hash)
  },
  verify(hash: string, secret: string): boolean {
    const stored = store.get(hash)
    return stored !== undefined && stored === secret
  },
}
