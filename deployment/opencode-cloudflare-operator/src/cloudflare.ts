import { config } from "./config.js";

const CF_API = "https://api.cloudflare.com/client/v4";

async function cfFetch(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.cfApiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as { success: boolean; errors: { message: string }[]; result: unknown };

  if (!data.success) {
    const msgs = data.errors.map((e) => e.message).join(", ");
    throw new Error(`Cloudflare API error [${method} ${path}]: ${msgs}`);
  }

  return data.result;
}

// ---------------------------------------------------------------------------
// DNS Records
// ---------------------------------------------------------------------------

/**
 * Find the Cloudflare DNS record ID for a given hostname, or null if not found.
 */
export async function findDnsRecord(hostname: string): Promise<string | null> {
  const result = (await cfFetch(
    `/zones/${config.cfZoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`,
    "GET"
  )) as { id: string }[];

  return result.length > 0 ? result[0].id : null;
}

/**
 * Create a proxied CNAME DNS record pointing to the Cloudflare tunnel.
 * Idempotent — skips creation if the record already exists (checked via GET
 * and also by treating the "already exists" POST error as a no-op, handling
 * the race when two operator replicas try to create the same record).
 */
export async function createDnsRecord(hostname: string, tunnelCname: string): Promise<void> {
  const existing = await findDnsRecord(hostname);
  if (existing) {
    console.log(`DNS record already exists for ${hostname} (${existing}), skipping`);
    return;
  }

  try {
    await cfFetch(`/zones/${config.cfZoneId}/dns_records`, "POST", {
      type: "CNAME",
      name: hostname,
      content: tunnelCname,
      proxied: true,
      ttl: 1,
      comment: "opencode session — managed by opencode-cloudflare-operator",
    });
  } catch (err) {
    // Two operator replicas may race — if the record was created between our
    // GET and POST, treat "already exists" as a success.
    if (err instanceof Error && err.message.includes("already exists")) {
      console.log(`DNS record already exists for ${hostname} (created concurrently), skipping`);
      return;
    }
    throw err;
  }

  console.log(`Created DNS record: ${hostname} → ${tunnelCname}`);
}

/**
 * Delete the CNAME DNS record for a hostname.
 * Idempotent — no-op if the record does not exist.
 */
export async function deleteDnsRecord(hostname: string): Promise<void> {
  const id = await findDnsRecord(hostname);
  if (!id) {
    console.log(`No DNS record found for ${hostname}, nothing to delete`);
    return;
  }

  await cfFetch(`/zones/${config.cfZoneId}/dns_records/${id}`, "DELETE");
  console.log(`Deleted DNS record: ${hostname}`);
}

// ---------------------------------------------------------------------------
// Tunnel Routes
// ---------------------------------------------------------------------------

/**
 * Get the tunnel CNAME (e.g. <uuid>.cfargotunnel.com) for the configured tunnel.
 * The CNAME is always <tunnel-id>.cfargotunnel.com — the Cloudflare API does not
 * expose a dedicated `cname` field; it is derived directly from the tunnel ID.
 */
export async function getTunnelCname(): Promise<string> {
  return `${config.cfTunnelId}.cfargotunnel.com`;
}

/** Fetch the account ID from the zone (needed for tunnel API) */
let _accountId: string | null = null;
async function getAccountId(): Promise<string> {
  if (_accountId) return _accountId;

  const result = (await cfFetch(`/zones/${config.cfZoneId}`, "GET")) as {
    account: { id: string };
  };

  _accountId = result.account.id;
  return _accountId;
}

/**
 * Get the current tunnel ingress configuration.
 */
async function getTunnelConfig(): Promise<{ ingress: IngressRule[] }> {
  const result = (await cfFetch(
    `/accounts/${await getAccountId()}/cfd_tunnel/${config.cfTunnelId}/configurations`,
    "GET"
  )) as { config: { ingress: IngressRule[] } };

  return result.config;
}

interface IngressRule {
  hostname?: string;
  service: string;
}

/**
 * Add a tunnel ingress rule for the given hostname → router service.
 * Idempotent — skips if already present.
 * Keeps the catch-all rule (no hostname) at the end.
 */
export async function createTunnelRoute(hostname: string): Promise<void> {
  const current = await getTunnelConfig();
  const ingress = current.ingress ?? [];

  // Check if already exists
  if (ingress.some((r) => r.hostname === hostname)) {
    console.log(`Tunnel route already exists for ${hostname}, skipping`);
    return;
  }

  // Insert before the catch-all (last entry has no hostname)
  const catchAll = ingress.filter((r) => !r.hostname);
  const named = ingress.filter((r) => r.hostname && r.hostname !== hostname);

  const newIngress: IngressRule[] = [
    ...named,
    { hostname, service: config.routerServiceUrl },
    ...catchAll,
  ];

  await cfFetch(
    `/accounts/${await getAccountId()}/cfd_tunnel/${config.cfTunnelId}/configurations`,
    "PUT",
    { config: { ingress: newIngress } }
  );

  console.log(`Created tunnel route: ${hostname} → ${config.routerServiceUrl}`);
}

/**
 * Remove the tunnel ingress rule for the given hostname.
 * Idempotent — no-op if not present.
 */
export async function deleteTunnelRoute(hostname: string): Promise<void> {
  const current = await getTunnelConfig();
  const ingress = current.ingress ?? [];

  const filtered = ingress.filter((r) => r.hostname !== hostname);
  if (filtered.length === ingress.length) {
    console.log(`No tunnel route found for ${hostname}, nothing to delete`);
    return;
  }

  await cfFetch(
    `/accounts/${await getAccountId()}/cfd_tunnel/${config.cfTunnelId}/configurations`,
    "PUT",
    { config: { ingress: filtered } }
  );

  console.log(`Deleted tunnel route: ${hostname}`);
}
