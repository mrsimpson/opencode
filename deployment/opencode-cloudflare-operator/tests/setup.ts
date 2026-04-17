// This file runs before any modules are loaded
// Set test environment variables here so they're available when config.ts is imported

process.env.CF_API_TOKEN = "test-token"
process.env.CF_ZONE_ID = "zone123"
process.env.CF_TUNNEL_ID = "tunnel123"
process.env.DOMAIN = "no-panic.org"
process.env.ROUTER_SERVICE_URL = "http://traefik-controller.traefik-system.svc.cluster.local:80"
process.env.WATCH_NAMESPACE = "code"
process.env.POD_LABEL_SELECTOR = "app.kubernetes.io/managed-by=opencode-router"
process.env.INGRESSROUTE_NAMESPACE = "code"
process.env.OAUTH2_CHAIN_MIDDLEWARE = "code-oauth2-chain"
process.env.ROUTER_SERVICE_NAME = "code"
process.env.HEALTH_PORT = "8080"
process.env.ROUTE_SUFFIX = "-oc"
