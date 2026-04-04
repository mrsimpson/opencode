function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  namespace: process.env.OPENCODE_NAMESPACE ?? "opencode",
  opencodeImage: required("OPENCODE_IMAGE"),
  opencodePort: 4096,
  idleTimeoutMinutes: Number(process.env.IDLE_TIMEOUT_MINUTES ?? 30),
  apiKeySecretName: process.env.API_KEY_SECRET_NAME ?? "opencode-api-keys",
  configMapName: process.env.CONFIG_MAP_NAME ?? "opencode-config-dir",
  imagePullSecretName: process.env.IMAGE_PULL_SECRET_NAME ?? "",
  storageClass: process.env.STORAGE_CLASS ?? "",
  storageSize: process.env.STORAGE_SIZE ?? "2Gi",
  defaultGitRepo: process.env.DEFAULT_GIT_REPO,
  publicDir: process.env.PUBLIC_DIR ?? new URL("../public", import.meta.url).pathname,
  /**
   * The public domain of the router (e.g. "opencode-router.no-panic.org").
   * Sessions are served at https://<hash>.<routerDomain>.
   * Required — subdomain routing is the only supported session isolation strategy.
   */
  routerDomain: required("ROUTER_DOMAIN"),
  /**
   * Dev-only: when set, the router proxies the setup UI to this Vite dev server URL
   * instead of serving static files from publicDir. Enables HMR without a redirect loop.
   * Example: DEV_VITE_URL=http://localhost:5173
   */
  devViteUrl: process.env.DEV_VITE_URL,
  /**
   * Dev-only: assumed email when X-Auth-Request-Email header is absent (never set in production)
   */
  devEmail: process.env.DEV_EMAIL,
  /**
   * Dev-only: fixed proxy target (e.g. "http://localhost:4096") used instead of looking up
   * the pod IP. Needed when running the router outside the cluster where pod IPs are unreachable.
   * Set this and port-forward the user pod: kubectl port-forward <pod> 4096:4096 -n opencode-router
   */
  devPodProxyTarget: process.env.DEV_POD_PROXY_TARGET,
} as const;
