import * as k8s from "@kubernetes/client-node";
import { config } from "./config.js";

/**
 * Traefik IngressRoute CRD spec shapes (minimal, untyped — we POST raw JSON).
 */
interface IngressRouteSpec {
  entryPoints: string[];
  routes: {
    match: string;
    kind: "Rule";
    middlewares?: { name: string; namespace: string }[];
    services: { name: string; namespace: string; port: number }[];
    priority?: number;
  }[];
}

// ---------------------------------------------------------------------------
// Kubernetes custom objects client
// ---------------------------------------------------------------------------

const kc = new k8s.KubeConfig();
import fs from "node:fs";
if (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

const customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);

const TRAEFIK_GROUP = "traefik.io";
const TRAEFIK_VERSION = "v1alpha1";
const INGRESSROUTE_PLURAL = "ingressroutes";

/** Derive stable IngressRoute names from the session hash */
function appRouteName(hash: string): string {
  return `opencode-session-${hash}-app`;
}
function signinRouteName(hash: string): string {
  return `opencode-session-${hash}-signin`;
}

/**
 * Create the two IngressRoute resources for a session hostname:
 *  1. Signin route: Host(`<hostname>`) && PathPrefix(`/oauth2/`) → oauth2-proxy
 *  2. App route:    Host(`<hostname>`)                           → opencode-router service
 *
 * Both mirror exactly what ExposedWebApp creates for the main opencode-router domain,
 * but point at the per-session hostname instead. Traffic hits Traefik via the
 * Cloudflare Tunnel and is routed to the opencode-router service (which then proxies
 * to the correct session pod via subdomain-based hash extraction).
 *
 * Idempotent — skips creation if the route already exists (HTTP 409).
 */
export async function createIngressRoutes(hostname: string): Promise<void> {
  const ns = config.ingressRouteNamespace;

  // Route 1 — /oauth2/* → oauth2-proxy-users (signin flow, no middleware)
  const signinSpec: IngressRouteSpec = {
    entryPoints: ["web"],
    routes: [
      {
        match: `Host(\`${hostname}\`) && PathPrefix(\`/oauth2/\`)`,
        kind: "Rule",
        services: [
          {
            name: "oauth2-proxy-users",
            namespace: "oauth2-proxy",
            port: 80,
          },
        ],
      },
    ],
  };

  // Route 2 — /* → opencode-router service, protected by oauth2 chain middleware
  const appSpec: IngressRouteSpec = {
    entryPoints: ["web"],
    routes: [
      {
        match: `Host(\`${hostname}\`)`,
        kind: "Rule",
        middlewares: [
          {
            name: config.oauth2ChainMiddleware,
            namespace: ns,
          },
        ],
        services: [
          {
            name: config.routerServiceName,
            namespace: ns,
            port: 80,
          },
        ],
        priority: 1,
      },
    ],
  };

  await Promise.all([
    createOrSkip(signinRouteName(hostname.split(".")[0]), ns, signinSpec),
    createOrSkip(appRouteName(hostname.split(".")[0]), ns, appSpec),
  ]);

  console.log(`Created IngressRoutes for ${hostname}`);
}

/**
 * Delete the two IngressRoute resources for a session hostname.
 * Idempotent — no-op if either resource is already gone.
 */
export async function deleteIngressRoutes(hostname: string): Promise<void> {
  const ns = config.ingressRouteNamespace;
  const hash = hostname.split(".")[0]; // e.g. "8b6cc2aa9a45-oc" — used only for name derivation

  await Promise.all([
    deleteOrSkip(signinRouteName(hash), ns),
    deleteOrSkip(appRouteName(hash), ns),
  ]);

  console.log(`Deleted IngressRoutes for ${hostname}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createOrSkip(
  name: string,
  namespace: string,
  spec: IngressRouteSpec
): Promise<void> {
  try {
    await customObjectsApi.createNamespacedCustomObject({
      group: TRAEFIK_GROUP,
      version: TRAEFIK_VERSION,
      namespace,
      plural: INGRESSROUTE_PLURAL,
      body: {
        apiVersion: `${TRAEFIK_GROUP}/${TRAEFIK_VERSION}`,
        kind: "IngressRoute",
        metadata: {
          name,
          namespace,
          labels: { "app.kubernetes.io/managed-by": "opencode-cloudflare-operator" },
        },
        spec,
      },
    });
    console.log(`Created IngressRoute ${namespace}/${name}`);
  } catch (err: unknown) {
    if (isConflict(err)) {
      console.log(`IngressRoute ${namespace}/${name} already exists, skipping`);
      return;
    }
    throw err;
  }
}

async function deleteOrSkip(name: string, namespace: string): Promise<void> {
  try {
    await customObjectsApi.deleteNamespacedCustomObject({
      group: TRAEFIK_GROUP,
      version: TRAEFIK_VERSION,
      namespace,
      plural: INGRESSROUTE_PLURAL,
      name,
    });
    console.log(`Deleted IngressRoute ${namespace}/${name}`);
  } catch (err: unknown) {
    if (isNotFound(err)) {
      console.log(`IngressRoute ${namespace}/${name} not found, skipping`);
      return;
    }
    throw err;
  }
}

function hasStatus(err: unknown): err is { response: { statusCode: number } } {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response: unknown }).response === "object" &&
    (err as { response: { statusCode?: unknown } }).response !== null &&
    "statusCode" in (err as { response: { statusCode?: unknown } }).response
  );
}

function isNotFound(err: unknown): boolean {
  return hasStatus(err) && err.response.statusCode === 404;
}

function isConflict(err: unknown): boolean {
  return hasStatus(err) && err.response.statusCode === 409;
}
