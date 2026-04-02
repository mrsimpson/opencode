function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  namespace: process.env.OPENCODE_NAMESPACE ?? "opencode",
  opencodeImage: required("OPENCODE_IMAGE"),
  opencodePort: 4096,
  idleTimeoutMinutes: Number(process.env.IDLE_TIMEOUT_MINUTES ?? 30),
  apiKeySecretName: process.env.API_KEY_SECRET_NAME ?? "opencode-api-keys",
  configMapName: process.env.CONFIG_MAP_NAME ?? "opencode-config-dir",
  storageClass: process.env.STORAGE_CLASS ?? "",
  storageSize: process.env.STORAGE_SIZE ?? "2Gi",
  defaultGitRepo: process.env.DEFAULT_GIT_REPO,
  publicDir: process.env.PUBLIC_DIR ?? new URL("../public", import.meta.url).pathname,
} as const
