import * as pulumi from "@pulumi/pulumi"
import * as k8s from "@pulumi/kubernetes"
import { AuthType, createHomelabContextFromStack } from "@mrsimpson/homelab-core-components"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_NAME = "code"
const NAMESPACE = APP_NAME
const ROUTER_PORT = 3000
const OPENCODE_PORT = 4096
/** Suffix appended to hash for session hostnames: <hash>-oc.<domain> */
const ROUTE_SUFFIX = "-oc"
/** In-cluster URL the Cloudflare operator routes session traffic to */
const ROUTER_SERVICE_URL = `http://${APP_NAME}.${NAMESPACE}.svc.cluster.local:80`
const CF_OPERATOR_CONTAINER_NAME = "cloudflare-operator"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const cfg = new pulumi.Config("code")
const cloudflareConfig = new pulumi.Config("cloudflare")

// StackReference to the homelab base stack — provides tunnelCname, cloudflareZoneId, domain
const homelabStackName = cfg.get("homelabStack") ?? "mrsimpson/homelab/dev"
const homelabStack = new pulumi.StackReference(homelabStackName)

// Read infrastructure facts from homelab stack outputs
const domain = homelabStack.getOutput("domain") as pulumi.Output<string>
const cfZoneId = homelabStack.getOutput("cloudflareZoneId") as pulumi.Output<string>

// Tunnel ID — needed by the Cloudflare operator sidecar.
// Exported from homelab stack as "tunnelId".
const cfTunnelId = homelabStack.getOutput("tunnelId") as pulumi.Output<string>

// Build HomelabContext from StackReference — homelab defaults apply
const homelab = createHomelabContextFromStack(homelabStack)

// ---------------------------------------------------------------------------
// App config
// ---------------------------------------------------------------------------

const routerImage = cfg.require("routerImage")
const cfOperatorImage = cfg.require("cfOperatorImage")
const opencodeImage = cfg.require("opencodeImage")
const anthropicApiKey = cfg.requireSecret("anthropicApiKey")
const defaultGitRepo = cfg.get("defaultGitRepo")
const storageSize = cfg.get("storageSize") ?? "2Gi"
// podEnv: optional multiline .env content injected into session pods via ConfigMap.
// Operators set arbitrary env vars here (e.g. "WORKFLOW_AGENTS=ade\nOPENCODE_MODEL=...").
const podEnv = cfg.get("podEnv") ?? ""
const cfApiToken = cloudflareConfig.requireSecret("apiToken")

// ---------------------------------------------------------------------------
// 1. Namespace (pre-created; passed to ExposedWebApp so it doesn't re-create)
// ---------------------------------------------------------------------------

const ns = new k8s.core.v1.Namespace(`${APP_NAME}-ns`, {
  metadata: {
    name: NAMESPACE,
    labels: {
      app: APP_NAME,
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/enforce-version": "latest",
      "pod-security.kubernetes.io/warn": "restricted",
      "pod-security.kubernetes.io/warn-version": "latest",
    },
  },
})

// ---------------------------------------------------------------------------
// 2. RBAC — router manages user pods/PVCs; operator sidecar watches pods and
//    manages IngressRoutes at runtime.
// ---------------------------------------------------------------------------

const serviceAccount = new k8s.core.v1.ServiceAccount(
  `${APP_NAME}-sa`,
  {
    metadata: {
      name: APP_NAME,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
  },
  { dependsOn: [ns] },
)

const role = new k8s.rbac.v1.Role(
  `${APP_NAME}-role`,
  {
    metadata: {
      name: APP_NAME,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list", "watch", "create", "delete", "patch"],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        verbs: ["get", "list", "create", "delete"],
      },
      {
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["get", "create", "patch", "delete"],
      },
      {
        apiGroups: ["traefik.io"],
        resources: ["ingressroutes"],
        verbs: ["get", "list", "create", "delete"],
      },
    ],
  },
  { dependsOn: [ns] },
)

const roleBinding = new k8s.rbac.v1.RoleBinding(
  `${APP_NAME}-rolebinding`,
  {
    metadata: {
      name: APP_NAME,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: APP_NAME,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: APP_NAME,
        namespace: NAMESPACE,
      },
    ],
  },
  { dependsOn: [role, serviceAccount] },
)

// ---------------------------------------------------------------------------
// 3. Secret — Anthropic API key mounted into session pods
// ---------------------------------------------------------------------------

const apiKeysSecret = new k8s.core.v1.Secret(
  `${APP_NAME}-api-keys`,
  {
    metadata: {
      name: "opencode-api-keys",
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    type: "Opaque",
    stringData: {
      ANTHROPIC_API_KEY: anthropicApiKey,
    },
  },
  { dependsOn: [ns] },
)

// ---------------------------------------------------------------------------
// 4. ConfigMap — opencode.json for session pods
// ---------------------------------------------------------------------------

const configMap = new k8s.core.v1.ConfigMap(
  `${APP_NAME}-config`,
  {
    metadata: {
      name: "opencode-config-dir",
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    data: {
      "opencode.json": JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          model: "anthropic/claude-sonnet-4-5",
        },
        null,
        2,
      ),
      // .env is sourced by the pod entrypoint before launching opencode.
      // Operators set arbitrary vars here, e.g. WORKFLOW_AGENTS=ade.
      // Empty by default — the source command is guarded with "|| true".
      ".env": podEnv,
    },
  },
  { dependsOn: [ns] },
)

// ---------------------------------------------------------------------------
// 5. ExternalSecret — GHCR pull secret
//    Explicitly created because ExposedWebApp only auto-creates it when it
//    creates the namespace. Since we pre-create the namespace and pass it in,
//    we must create this manually.
// ---------------------------------------------------------------------------

const pullSecret = new k8s.apiextensions.CustomResource(
  `${APP_NAME}-ghcr-pull-secret`,
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ExternalSecret",
    metadata: {
      name: "ghcr-pull-secret",
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    spec: {
      refreshInterval: "1h",
      secretStoreRef: {
        name: "pulumi-esc",
        kind: "ClusterSecretStore",
      },
      target: {
        name: "ghcr-pull-secret",
        creationPolicy: "Owner",
        template: {
          type: "kubernetes.io/dockerconfigjson",
          engineVersion: "v2",
          data: {
            ".dockerconfigjson": `{"auths":{"ghcr.io":{"username":"{{ .github_username }}","password":"{{ .github_token }}","auth":"{{ printf "%s:%s" .github_username .github_token | b64enc }}"}}}`,
          },
        },
      },
      data: [
        {
          secretKey: "github_username",
          remoteRef: { key: "github-username" },
        },
        {
          secretKey: "github_token",
          remoteRef: { key: "github-token" },
        },
      ],
    },
  },
  { dependsOn: [ns] },
)

// ---------------------------------------------------------------------------
// 6. Secret — Cloudflare credentials for the operator sidecar
// ---------------------------------------------------------------------------

const cfSecret = new k8s.core.v1.Secret(
  `${APP_NAME}-cf-credentials`,
  {
    metadata: {
      name: `${APP_NAME}-cf-credentials`,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    type: "Opaque",
    stringData: {
      CF_API_TOKEN: cfApiToken,
    },
  },
  { dependsOn: [ns] },
)

// ---------------------------------------------------------------------------
// 7. Cloudflare operator sidecar container spec
//    Watches session pods, manages <hash>-oc.<domain> DNS + tunnel routes.
// ---------------------------------------------------------------------------

const operatorSidecar = [
  {
    name: CF_OPERATOR_CONTAINER_NAME,
    image: pulumi.output(cfOperatorImage),
    securityContext: {
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
    },
    env: [
      { name: "WATCH_NAMESPACE", value: NAMESPACE },
      {
        name: "POD_LABEL_SELECTOR",
        value: "app.kubernetes.io/managed-by=opencode-router",
      },
      { name: "CF_ZONE_ID", value: cfZoneId },
      { name: "CF_TUNNEL_ID", value: cfTunnelId },
      { name: "DOMAIN", value: domain },
      { name: "ROUTE_SUFFIX", value: ROUTE_SUFFIX },
      { name: "ROUTER_SERVICE_URL", value: ROUTER_SERVICE_URL },
      { name: "INGRESSROUTE_NAMESPACE", value: NAMESPACE },
      { name: "OAUTH2_CHAIN_MIDDLEWARE", value: `${APP_NAME}-oauth2-chain` },
      { name: "ROUTER_SERVICE_NAME", value: APP_NAME },
      {
        name: "CF_API_TOKEN",
        valueFrom: {
          secretKeyRef: {
            name: `${APP_NAME}-cf-credentials`,
            key: "CF_API_TOKEN",
          },
        },
      },
    ],
    readinessProbe: {
      httpGet: { path: "/healthz", port: 8080 },
      initialDelaySeconds: 5,
      periodSeconds: 10,
    },
    livenessProbe: {
      httpGet: { path: "/healthz", port: 8080 },
      initialDelaySeconds: 15,
      periodSeconds: 30,
    },
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "200m", memory: "128Mi" },
    },
  },
]

// ---------------------------------------------------------------------------
// 8. ExposedWebApp — Deployment, Service, OAuth2-Proxy auth, main DNS CNAME
// ---------------------------------------------------------------------------

const appDomain = pulumi.interpolate`${APP_NAME}.${domain}`

export const app = homelab.createExposedWebApp(
  APP_NAME,
  {
    namespace: ns,
    image: pulumi.output(routerImage),
    domain: appDomain,
    port: ROUTER_PORT,
    replicas: 1,
    auth: AuthType.OAUTH2_PROXY,
    // --pass-access-token=true is required so oauth2-proxy forwards the GitHub OAuth
    // token as X-Auth-Request-Token. The router stores it in a per-session Secret
    // (opencode-github-<hash>) and mounts it into pods so git push / gh CLI work.
    oauth2Proxy: { group: "users", extraArgs: ["--pass-access-token=true"] },
    serviceAccountName: APP_NAME,
    imagePullSecrets: [{ name: "ghcr-pull-secret" }],
    securityContext: {
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
    },
    resources: {
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
    env: [
      { name: "OPENCODE_IMAGE", value: pulumi.output(opencodeImage) },
      { name: "OPENCODE_NAMESPACE", value: NAMESPACE },
      { name: "OPENCODE_PORT", value: String(OPENCODE_PORT) },
      { name: "STORAGE_CLASS", value: "longhorn-uncritical" },
      { name: "STORAGE_SIZE", value: storageSize },
      { name: "API_KEY_SECRET_NAME", value: "opencode-api-keys" },
      { name: "CONFIG_MAP_NAME", value: "opencode-config-dir" },
      { name: "IMAGE_PULL_SECRET_NAME", value: "ghcr-pull-secret" },
      { name: "ROUTER_DOMAIN", value: domain },
      { name: "ROUTE_SUFFIX", value: ROUTE_SUFFIX },
      ...(defaultGitRepo ? [{ name: "DEFAULT_GIT_REPO", value: defaultGitRepo }] : []),
    ],
    probes: {
      readinessProbe: {
        httpGet: {
          path: "/api/sessions",
          port: ROUTER_PORT,
          httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
        },
        initialDelaySeconds: 5,
        periodSeconds: 10,
        failureThreshold: 3,
      },
      livenessProbe: {
        httpGet: {
          path: "/api/sessions",
          port: ROUTER_PORT,
          httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
        },
        initialDelaySeconds: 15,
        periodSeconds: 30,
        failureThreshold: 3,
      },
    },
    extraContainers: operatorSidecar,
    tags: ["opencode", "router", "ai"],
  },
  {
    dependsOn: [roleBinding, pullSecret, cfSecret, apiKeysSecret, configMap],
  },
)

// ---------------------------------------------------------------------------
// Stack outputs
// ---------------------------------------------------------------------------

export const url = pulumi.interpolate`https://${appDomain}`
export const namespace = app.namespace.metadata.name
