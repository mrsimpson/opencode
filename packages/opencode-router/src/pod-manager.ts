import crypto from "node:crypto"
import fs from "node:fs"
import * as k8s from "@kubernetes/client-node"
import { humanId as _humanId } from "human-id"
import { config } from "./config.js"

const kc = new k8s.KubeConfig()
// loadFromCluster() does not throw when not in a pod — it silently produces
// an invalid config with server=undefined. Check for the SA token file first.
if (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
let k8sApi: k8s.CoreV1Api = kc.makeApiClient(k8s.CoreV1Api)
let humanId: typeof _humanId = _humanId
// Narrow function type — `typeof fetch` differs between Bun and DOM lib
// (Bun adds a `preconnect` property), which breaks `tsc` in the Docker build.
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
let fetchImpl: FetchFn = (url, init) => globalThis.fetch(url, init)
let activityFetchImpl: FetchFn = (url, init) => globalThis.fetch(url, init)

/** For testing only: replace the k8s API client with a fake. */
export function _setApiClient(client: k8s.CoreV1Api) {
  k8sApi = client
}

/** For testing only: replace the humanId generator. */
export function _setHumanId(fn: typeof _humanId) {
  humanId = fn
}

/** For testing only: replace the fetch implementation used by remoteBranchExists. */
export function _setFetch(fn: FetchFn) {
  fetchImpl = fn
}

/** For testing only: replace the fetch implementation used to poll pod activity. */
export function _setActivityFetch(fn: FetchFn) {
  activityFetchImpl = fn
}

const LABEL_SESSION_HASH = "opencode.ai/session-hash"
const LABEL_MANAGED_BY = "app.kubernetes.io/managed-by"
const MANAGED_BY_VALUE = "opencode-router"
const ANNOTATION_LAST_ACTIVITY = "opencode.ai/last-activity"
const ANNOTATION_USER_EMAIL = "opencode.ai/user-email"
const ANNOTATION_REPO_URL = "opencode.ai/repo-url"
const ANNOTATION_BRANCH = "opencode.ai/branch"
const ANNOTATION_SOURCE_BRANCH = "opencode.ai/source-branch"

/** In-memory throttle for annotation updates: hash → last update epoch ms */
const activityThrottle = new Map<string, number>()
const THROTTLE_MS = 60_000

export interface SessionKey {
  email: string
  repoUrl: string
  /** Session branch — auto-generated unique name (e.g. "calm-snails-dream"). Forms part of the session identity hash. */
  branch: string
  /** Source branch the user starts from (e.g. "main"). Used by git-init to set the starting point. */
  sourceBranch: string
}

export interface SessionInfo {
  hash: string
  email: string
  repoUrl: string
  /** Session branch (auto-generated, e.g. "calm-snails-dream") */
  branch: string
  /** Source branch the session was created from (e.g. "main") */
  sourceBranch: string
  state: PodState
  url: string
  lastActivity: string
  idleTimeoutMinutes: number
}

/**
 * Compute a deterministic, DNS-safe 12-char hex hash for a (email, repoUrl, branch) triple.
 * This is the stable identity for a session — used for pod name, PVC name, and URL slug.
 */
export function getSessionHash(email: string, repoUrl: string, branch: string): string {
  const key = `${email.toLowerCase().trim()}:${repoUrl.trim()}:${branch.trim()}`
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)
}

function podName(hash: string): string {
  return `opencode-session-${hash}`
}

function pvcName(hash: string): string {
  return `opencode-pvc-${hash}`
}

function sessionLabels(hash: string): Record<string, string> {
  return {
    [LABEL_SESSION_HASH]: hash,
    [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
  }
}

/**
 * Create PVC for a session if it doesn't exist. Idempotent.
 */
export async function ensurePVC(session: SessionKey): Promise<void> {
  const hash = getSessionHash(session.email, session.repoUrl, session.branch)
  const name = pvcName(hash)

  try {
    await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
    return // already exists
  } catch (err) {
    if (!isNotFound(err)) throw err
  }

  const pvc: k8s.V1PersistentVolumeClaim = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: sessionLabels(hash),
      annotations: {
        [ANNOTATION_USER_EMAIL]: session.email,
        [ANNOTATION_REPO_URL]: session.repoUrl,
        [ANNOTATION_BRANCH]: session.branch,
        [ANNOTATION_SOURCE_BRANCH]: session.sourceBranch,
      },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(config.storageClass && { storageClassName: config.storageClass }),
      resources: {
        requests: { storage: config.storageSize },
      },
    },
  }

  try {
    await k8sApi.createNamespacedPersistentVolumeClaim({ namespace: config.namespace, body: pvc })
  } catch (err) {
    if (!isConflict(err)) throw err
  }
}

export type PodState = "none" | "creating" | "running" | "stopped"

/**
 * Return the current state of a session's pod by its hash.
 */
export async function getPodState(hash: string): Promise<PodState> {
  const name = podName(hash)
  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace })
    if (pod.status?.phase === "Running" && pod.status.podIP) return "running"
    return "creating"
  } catch (err) {
    if (isNotFound(err)) return "none"
    throw err
  }
}

/**
 * Create pod for a session if it doesn't exist. Idempotent. Must call ensurePVC first.
 *
 * The git-init container:
 * - Clones repoUrl into /workspace if not already cloned
 * - Checks out `branch` if it exists remotely, otherwise creates it from the default branch
 */
export async function ensurePod(session: SessionKey): Promise<string> {
  const hash = getSessionHash(session.email, session.repoUrl, session.branch)
  const name = podName(hash)

  try {
    await k8sApi.readNamespacedPod({ name, namespace: config.namespace })
    return hash // already exists
  } catch (err) {
    if (!isNotFound(err)) throw err
  }

  const now = new Date().toISOString()
  const { repoUrl, branch, sourceBranch, email } = session

  // The repo is cloned directly into /workspace (init container) which maps to <PVC>/projects/
  // via subPath "projects". The main container mounts the full PVC at /home/opencode (no subPath),
  // so the cloned repo is at /home/opencode/projects/ inside the main container. We set workingDir
  // accordingly so opencode serve starts in the git repo and correctly discovers the project.
  const workspacePath = `/home/opencode/projects`

  // Single init container using the opencode image (which already has git).
  // Phase 1 — config seed (idempotent): copy /etc/opencode-defaults → ~/.config/opencode on first start,
  //   then run any *.sh scripts in init-scripts/ (e.g. skills install). Skipped on pod restart.
  // Phase 2 — git: clone repo + checkout session branch. Safe.directory avoids needing a writable HOME.
  const initScript = [
    `set -e`,
    // --- config phase (idempotent) ---
    `if [ ! -d /home/opencode/.config/opencode ]; then`,
    `  mkdir -p /home/opencode/.config/opencode`,
    `  cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/`,
    `  for s in /etc/opencode-defaults/init-scripts/*.sh; do`,
    `    [ -f "$s" ] && sh "$s" || true`,
    `  done`,
    `fi`,
    // --- git phase ---
    `GIT="git -c safe.directory=/workspace"`,
    `if [ ! -d /workspace/.git ]; then`,
    `  git clone "${repoUrl}" /workspace`,
    `fi`,
    `cd /workspace`,
    `$GIT fetch --all`,
    `if $GIT rev-parse --verify "${branch}" >/dev/null 2>&1; then`,
    `  $GIT checkout "${branch}"`,
    `else`,
    `  $GIT checkout -B "${sourceBranch}" "origin/${sourceBranch}"`,
    `  $GIT checkout -b "${branch}"`,
    `fi`,
  ].join("\n")

  const secCtx: k8s.V1SecurityContext = {
    runAsUser: 1000,
    runAsGroup: 1000,
    allowPrivilegeEscalation: false,
    runAsNonRoot: true,
    capabilities: { drop: ["ALL"] },
    seccompProfile: { type: "RuntimeDefault" },
  }

  const initContainers: k8s.V1Container[] = [
    {
      name: "init",
      securityContext: secCtx,
      image: config.opencodeImage,
      command: ["sh", "-c"],
      args: [initScript],
      volumeMounts: [
        { name: "user-data", mountPath: "/home/opencode" },
        { name: "user-data", mountPath: "/workspace", subPath: "projects" },
      ],
    },
  ]

  const pod: k8s.V1Pod = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: sessionLabels(hash),
      annotations: {
        [ANNOTATION_LAST_ACTIVITY]: now,
        [ANNOTATION_USER_EMAIL]: email,
        [ANNOTATION_REPO_URL]: repoUrl,
        [ANNOTATION_BRANCH]: branch,
        [ANNOTATION_SOURCE_BRANCH]: sourceBranch,
      },
    },
    spec: {
      restartPolicy: "Always",
      securityContext: {
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
      ...(config.imagePullSecretName ? { imagePullSecrets: [{ name: config.imagePullSecretName }] } : {}),
      initContainers,
      containers: [
        {
          name: "opencode",
          image: config.opencodeImage,
          // Start the process in the cloned repo directory so opencode discovers the git project.
          // The init container clones directly into /workspace (subPath "projects" on the PVC).
          // The main container mounts the full PVC at /home/opencode, so the repo is at
          // /home/opencode/projects/.
          workingDir: workspacePath,
          // Source /home/opencode/.opencode/.env if present — lets operators inject arbitrary
          // env vars (e.g. WORKFLOW_AGENTS) via the existing ConfigMap without touching router code.
          command: [
            "sh",
            "-c",
            `set -a; . /home/opencode/.opencode/.env 2>/dev/null || true; set +a; exec opencode serve --hostname 0.0.0.0 --port ${config.opencodePort}`,
          ],
          ports: [{ containerPort: config.opencodePort }],
          envFrom: [{ secretRef: { name: config.apiKeySecretName } }],
          securityContext: {
            allowPrivilegeEscalation: false,
            runAsNonRoot: true,
            capabilities: { drop: ["ALL"] },
            seccompProfile: { type: "RuntimeDefault" },
          },
          volumeMounts: [
            { name: "user-data", mountPath: "/home/opencode" },
            { name: "opencode-config", mountPath: "/home/opencode/.opencode", readOnly: true },
          ],
        },
      ],
      volumes: [
        {
          name: "user-data",
          persistentVolumeClaim: { claimName: pvcName(hash) },
        },
        {
          name: "opencode-config",
          configMap: { name: config.configMapName },
        },
      ],
    },
  }

  try {
    await k8sApi.createNamespacedPod({ namespace: config.namespace, body: pod })
  } catch (err) {
    if (!isConflict(err)) throw err
  }

  return hash
}

/**
 * Return the pod's IP if it is Running, or null otherwise. Looks up by session hash.
 */
export async function getPodIP(hash: string): Promise<string | null> {
  const name = podName(hash)
  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace })
    if (pod.status?.phase === "Running" && pod.status.podIP) return pod.status.podIP
    return null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * List all sessions belonging to a user (by email annotation).
 * Pass the incoming request so URLs can be built with the correct scheme.
 */
export async function listUserSessions(
  email: string,
  req: import("node:http").IncomingMessage,
): Promise<SessionInfo[]> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http"

  const pvcList = await k8sApi.listNamespacedPersistentVolumeClaim({
    namespace: config.namespace,
    labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
  })

  const userPVCs = pvcList.items.filter(
    (pvc: k8s.V1PersistentVolumeClaim) => pvc.metadata?.annotations?.[ANNOTATION_USER_EMAIL] === email,
  )
  if (userPVCs.length === 0) return []

  const podList = await k8sApi.listNamespacedPod({
    namespace: config.namespace,
    labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
  })
  const podMap = new Map<string, k8s.V1Pod>()
  for (const pod of podList.items) {
    const h = pod.metadata?.labels?.[LABEL_SESSION_HASH]
    if (h) podMap.set(h, pod)
  }

  return Promise.all(
    userPVCs.map(async (pvc: k8s.V1PersistentVolumeClaim) => {
      const ann = pvc.metadata?.annotations ?? {}
      const hash = pvc.metadata?.labels?.[LABEL_SESSION_HASH] ?? ""
      const pod = podMap.get(hash)

      let state: PodState
      if (!pod) {
        state = "stopped"
      } else if (pod.status?.phase === "Running" && pod.status?.podIP) {
        state = "running"
      } else {
        state = "creating"
      }

      const annotationActivity =
        pod?.metadata?.annotations?.[ANNOTATION_LAST_ACTIVITY] ??
        ann[ANNOTATION_LAST_ACTIVITY] ??
        new Date().toISOString()

      let lastActivity = annotationActivity
      if (state === "running" && pod?.status?.podIP) {
        const instanceMs = await podActivityMs(pod.status.podIP)
        if (instanceMs !== null && instanceMs > new Date(annotationActivity).getTime()) {
          lastActivity = new Date(instanceMs).toISOString()
        }
      }

      return {
        hash,
        email,
        repoUrl: ann[ANNOTATION_REPO_URL] ?? "",
        branch: ann[ANNOTATION_BRANCH] ?? "",
        sourceBranch: ann[ANNOTATION_SOURCE_BRANCH] ?? "",
        state,
        url: `${proto}://${hash}${config.routeSuffix}.${config.routerDomain}`,
        lastActivity,
        idleTimeoutMinutes: config.idleTimeoutMinutes,
      }
    }),
  )
}

/**
 * Update the last-activity annotation on a session's pod.
 * Throttled to at most once per minute per session to reduce K8s API load.
 */
export function updateLastActivity(hash: string): void {
  const now = Date.now()
  const last = activityThrottle.get(hash) ?? 0
  if (now - last < THROTTLE_MS) return

  activityThrottle.set(hash, now)
  const name = podName(hash)

  k8sApi
    .patchNamespacedPod({
      name,
      namespace: config.namespace,
      body: {
        metadata: {
          annotations: { [ANNOTATION_LAST_ACTIVITY]: new Date(now).toISOString() },
        },
      },
    })
    .catch((err) => {
      console.error(`Failed to update last-activity for ${name}:`, err)
    })
}

/**
 * Delete pods that have been idle longer than the configured timeout.
 * Only deletes pods — PVCs are preserved.
 */
export async function deleteIdlePods(): Promise<void> {
  const cutoff = Date.now() - config.idleTimeoutMinutes * 60_000

  try {
    const response = await k8sApi.listNamespacedPod({
      namespace: config.namespace,
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
    })

    for (const pod of response.items) {
      const lastActivity = pod.metadata?.annotations?.[ANNOTATION_LAST_ACTIVITY]
      if (!lastActivity) continue

      const lastMs = new Date(lastActivity).getTime()
      if (lastMs < cutoff) {
        const name = pod.metadata?.name
        if (!name) continue

        // Before deleting, poll the instance for real activity (WS sessions don't update annotation)
        const ip = pod.status?.podIP
        if (ip) {
          const instanceMs = await podActivityMs(ip)
          if (instanceMs !== null && instanceMs >= cutoff) {
            // Instance has recent activity — refresh annotation and skip deletion
            await k8sApi
              .patchNamespacedPod({
                name,
                namespace: config.namespace,
                body: { metadata: { annotations: { [ANNOTATION_LAST_ACTIVITY]: new Date(instanceMs).toISOString() } } },
              })
              .catch((err) => console.error(`Failed to patch activity for ${name}:`, err))
            continue
          }
        }

        console.log(`Deleting idle pod ${name} (last activity: ${lastActivity})`)
        await k8sApi
          .deleteNamespacedPod({ name, namespace: config.namespace })
          .catch((err) => console.error(`Failed to delete pod ${name}:`, err))

        const hash = pod.metadata?.labels?.[LABEL_SESSION_HASH]
        if (hash) activityThrottle.delete(hash)
      }
    }
  } catch (err) {
    console.error("Failed to list pods for idle cleanup:", err)
  }
}

/**
 * Terminate a session: delete pod (if present) + PVC. Irreversible.
 * Only the session owner (email matching PVC annotation) may terminate.
 */
export async function terminateSession(hash: string, email: string): Promise<void> {
  const name = pvcName(hash)
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) throw new Error("NotFound")
    throw err
  }

  const owner = pvc.metadata?.annotations?.[ANNOTATION_USER_EMAIL]
  if (owner !== email) throw new Error("Forbidden")

  // Delete pod if it exists (ignore NotFound)
  await k8sApi.deleteNamespacedPod({ name: podName(hash), namespace: config.namespace }).catch((err) => {
    if (!isNotFound(err)) throw err
  })

  // Delete PVC
  await k8sApi.deleteNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })

  activityThrottle.delete(hash)
}

/**
 * Resume a stopped session: recreate the pod for an existing PVC.
 * Idempotent — safe to call when pod already exists.
 * Only the session owner may resume.
 */
export async function resumeSession(hash: string, email: string): Promise<void> {
  const name = pvcName(hash)
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) throw new Error("NotFound")
    throw err
  }

  const ann = pvc.metadata?.annotations ?? {}
  if (ann[ANNOTATION_USER_EMAIL] !== email) throw new Error("Forbidden")

  const session: SessionKey = {
    email: ann[ANNOTATION_USER_EMAIL] ?? email,
    repoUrl: ann[ANNOTATION_REPO_URL] ?? "",
    branch: ann[ANNOTATION_BRANCH] ?? "",
    sourceBranch: ann[ANNOTATION_SOURCE_BRANCH] ?? "",
  }

  await ensurePod(session)
}

function hasCode(err: unknown): err is { code: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "number"
  )
}

function isNotFound(err: unknown): boolean {
  return hasCode(err) && err.code === 404
}

function isConflict(err: unknown): boolean {
  return hasCode(err) && err.code === 409
}

/** Poll a running pod's /experimental/session endpoint. Returns time.updated ms or null. */
async function podActivityMs(ip: string): Promise<number | null> {
  try {
    const res = await activityFetchImpl(`http://${ip}:${config.opencodePort}/experimental/session?limit=1`)
    if (!res.ok) return null
    const data = (await res.json()) as { time: { updated: number } }[]
    return data[0]?.time?.updated ?? null
  } catch {
    return null
  }
}

/**
 * Error thrown when a remote ref lookup cannot be completed (network failure, non-OK HTTP status).
 * Distinct from "branch missing" (which returns false) so callers can respond with 502 vs 400.
 */
export class RemoteRefsUnreachableError extends Error {
  constructor(repoUrl: string, cause: string) {
    super(`Could not reach ${repoUrl}: ${cause}`)
    this.name = "RemoteRefsUnreachableError"
  }
}

/**
 * Check whether a branch exists on a remote git repository via the Smart HTTP protocol.
 * Queries `<repoUrl>/info/refs?service=git-upload-pack` and scans the advertised refs for
 * `refs/heads/<branch>`. Works without git installed in the runtime image.
 *
 * Returns true if the branch is advertised, false if it isn't.
 * Throws RemoteRefsUnreachableError if the remote can't be reached or returns non-OK.
 */
export async function remoteBranchExists(repoUrl: string, branch: string): Promise<boolean> {
  const base = repoUrl.trim().replace(/\/+$/, "")
  const url = `${base}/info/refs?service=git-upload-pack`
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": "git/opencode-router" } })
  } catch (err) {
    throw new RemoteRefsUnreachableError(repoUrl, err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    throw new RemoteRefsUnreachableError(repoUrl, `HTTP ${res.status}`)
  }
  const body = await res.text()
  // Smart HTTP protocol v1 advertises each ref as "<sha> refs/heads/<name>" terminated by
  // \0 (first ref, before capabilities) or \n (subsequent refs). Match with an explicit
  // terminator so a branch "foo" doesn't accidentally match "foo-bar".
  const marker = `refs/heads/${branch}`
  let idx = 0
  while ((idx = body.indexOf(marker, idx)) !== -1) {
    const next = body.charAt(idx + marker.length)
    if (next === "\0" || next === "\n") return true
    idx += marker.length
  }
  return false
}

/**
 * Generate a collision-safe human-readable branch name.
 * Checks existing PVCs to avoid reusing a name for the same (email, repoUrl) pair.
 * Caps at 10 iterations; returns last candidate if all collide.
 */
export async function suggestBranch(email: string, repoUrl: string): Promise<string> {
  let candidate = ""
  for (let i = 0; i < 10; i++) {
    candidate = humanId({ separator: "-", capitalize: false })
    const hash = getSessionHash(email, repoUrl, candidate)
    try {
      await k8sApi.readNamespacedPersistentVolumeClaim({ name: pvcName(hash), namespace: config.namespace })
      // PVC exists — collision, try next
    } catch (err) {
      if (isNotFound(err)) return candidate
      throw err
    }
  }
  return candidate
}
