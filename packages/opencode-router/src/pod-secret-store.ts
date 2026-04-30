// STUB — returns wrong values so tests fail on assertions
export const podSecretStore = {
  generate(_hash: string): string {
    // stub: returns wrong length / wrong value
    return "stub"
  },
  get(_hash: string): string | undefined {
    // stub: always undefined
    return undefined
  },
  delete(_hash: string): void {
    // stub: no-op
  },
  verify(_hash: string, _secret: string): boolean {
    // stub: always false
    return false
  },
}
