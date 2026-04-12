function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  /** Kubernetes namespace to watch for session pods */
  watchNamespace: process.env.WATCH_NAMESPACE ?? "opencode-router",
  /** Label selector identifying session pods */
  podLabelSelector:
    process.env.POD_LABEL_SELECTOR ?? "app.kubernetes.io/managed-by=opencode-router",
  /** Label key holding the 12-char hex session hash */
  sessionHashLabel: "opencode.ai/session-hash",
  /** Cloudflare API token (DNS:Edit + Zone:Read) */
  cfApiToken: required("CF_API_TOKEN"),
  /** Cloudflare Zone ID */
  cfZoneId: required("CF_ZONE_ID"),
  /** Cloudflare Tunnel ID */
  cfTunnelId: required("CF_TUNNEL_ID"),
  /** Base domain, e.g. "no-panic.org" */
  domain: required("DOMAIN"),
  /** Suffix appended to the hash, e.g. "-oc" → <hash>-oc.<domain> */
  routeSuffix: process.env.ROUTE_SUFFIX ?? "",
  /** In-cluster router service URL all session traffic is forwarded to */
  routerServiceUrl: required("ROUTER_SERVICE_URL"),
  /** Port for the health check HTTP server */
  healthPort: Number(process.env.HEALTH_PORT ?? 8080),
  /**
   * Namespace where IngressRoute resources are created.
   * Must match the namespace that owns the oauth2 chain middleware.
   * Defaults to watchNamespace (opencode-router).
   */
  ingressRouteNamespace: process.env.INGRESSROUTE_NAMESPACE ?? process.env.WATCH_NAMESPACE ?? "opencode-router",
  /**
   * Name of the Traefik Middleware chain that enforces OAuth2 auth.
   * Created by ExposedWebApp for the main router domain; reused for session routes.
   * e.g. "opencode-router-oauth2-chain"
   */
  oauth2ChainMiddleware: process.env.OAUTH2_CHAIN_MIDDLEWARE ?? "opencode-router-oauth2-chain",
  /**
   * Name of the in-cluster Kubernetes Service for the opencode-router.
   * Session IngressRoutes forward all traffic here; the router then proxies
   * to the correct pod based on the hash in the hostname.
   */
  routerServiceName: process.env.ROUTER_SERVICE_NAME ?? "opencode-router",
};

/** Compute the public hostname for a given session hash */
export function sessionHostname(hash: string): string {
  return `${hash}${config.routeSuffix}.${config.domain}`;
}
