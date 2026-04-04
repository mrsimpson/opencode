import crypto from "node:crypto";
import fs from "node:fs";
import * as k8s from "@kubernetes/client-node";
import { config } from "./config.js";

const kc = new k8s.KubeConfig();
// loadFromCluster() does not throw when not in a pod — it silently produces
// an invalid config with server=undefined. Check for the SA token file first.
if (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

const LABEL_USER_HASH = "opencode.ai/user-hash";
const LABEL_MANAGED_BY = "app.kubernetes.io/managed-by";
const MANAGED_BY_VALUE = "opencode-router";
const ANNOTATION_LAST_ACTIVITY = "opencode.ai/last-activity";
const ANNOTATION_USER_EMAIL = "opencode.ai/user-email";

/** In-memory throttle for annotation updates: hash → last update epoch ms */
const activityThrottle = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function getUserHash(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 12);
}

function podName(hash: string): string {
  return `opencode-user-${hash}`;
}

function pvcName(hash: string): string {
  return `opencode-pvc-${hash}`;
}

function userLabels(hash: string): Record<string, string> {
  return {
    [LABEL_USER_HASH]: hash,
    [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
  };
}

/**
 * Create PVC if it doesn't exist. Idempotent — handles 404 (create) and 409 (race).
 */
export async function ensurePVC(email: string): Promise<void> {
  const hash = getUserHash(email);
  const name = pvcName(hash);

  try {
    await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace });
    return; // already exists
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const pvc: k8s.V1PersistentVolumeClaim = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: userLabels(hash),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(config.storageClass && { storageClassName: config.storageClass }),
      resources: {
        requests: { storage: config.storageSize },
      },
    },
  };

  try {
    await k8sApi.createNamespacedPersistentVolumeClaim({ namespace: config.namespace, body: pvc });
  } catch (err) {
    if (!isConflict(err)) throw err;
    // 409 — another replica created it between our read and create
  }
}

export type PodState = "none" | "creating" | "running";

/**
 * Return the current state of a user's pod without creating it.
 */
export async function getPodState(email: string): Promise<PodState> {
  const hash = getUserHash(email);
  const name = podName(hash);

  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace });
    if (pod.status?.phase === "Running" && pod.status.podIP) {
      return "running";
    }
    return "creating";
  } catch (err) {
    if (isNotFound(err)) return "none";
    throw err;
  }
}

/**
 * Create pod if it doesn't exist. Idempotent. Must call ensurePVC first.
 */
export async function ensurePod(email: string, gitRepo?: string): Promise<void> {
  const hash = getUserHash(email);
  const name = podName(hash);

  try {
    await k8sApi.readNamespacedPod({ name, namespace: config.namespace });
    return; // already exists
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const now = new Date().toISOString();
  const repoUrl = gitRepo ?? config.defaultGitRepo;

  const initContainers: k8s.V1Container[] = [];
  if (repoUrl) {
    initContainers.push({
      name: "git-init",
      securityContext: {
        runAsUser: 1000,
        runAsGroup: 1000,
        allowPrivilegeEscalation: false,
        runAsNonRoot: true,
        capabilities: { drop: ["ALL"] },
        seccompProfile: { type: "RuntimeDefault" },
      },
      image: "alpine/git:latest",
      command: ["sh", "-c"],
      args: [
        `if [ ! -d /workspace/.git ]; then git clone ${repoUrl} /workspace && cd /workspace && git checkout -b opencode/${hash}; fi`,
      ],
      volumeMounts: [{ name: "user-data", mountPath: "/workspace", subPath: "projects" }],
    });
  }

  const pod: k8s.V1Pod = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: userLabels(hash),
      annotations: {
        [ANNOTATION_LAST_ACTIVITY]: now,
        [ANNOTATION_USER_EMAIL]: email,
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
      ...(config.imagePullSecretName
        ? { imagePullSecrets: [{ name: config.imagePullSecretName }] }
        : {}),
      initContainers: initContainers.length > 0 ? initContainers : undefined,
      containers: [
        {
          name: "opencode",
          image: config.opencodeImage,
          command: [
            "opencode",
            "serve",
            "--hostname",
            "0.0.0.0",
            "--port",
            String(config.opencodePort),
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
            { name: "user-data", mountPath: "/root" },
            { name: "opencode-config", mountPath: "/root/.opencode", readOnly: true },
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
  };

  try {
    await k8sApi.createNamespacedPod({ namespace: config.namespace, body: pod });
  } catch (err) {
    if (!isConflict(err)) throw err;
  }
}

/**
 * Return the pod's IP if it is Running, or null otherwise.
 */
export async function getPodIP(email: string): Promise<string | null> {
  const hash = getUserHash(email);
  const name = podName(hash);

  try {
    const response = await k8sApi.readNamespacedPod({ name, namespace: config.namespace });
    const pod = response;
    if (pod.status?.phase === "Running" && pod.status.podIP) {
      return pod.status.podIP;
    }
    return null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Update the last-activity annotation on the user's pod.
 * Throttled to at most once per minute per user to reduce K8s API load.
 */
export function updateLastActivity(email: string): void {
  const hash = getUserHash(email);
  const now = Date.now();
  const last = activityThrottle.get(hash) ?? 0;
  if (now - last < THROTTLE_MS) return;

  activityThrottle.set(hash, now);
  const name = podName(hash);

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
      console.error(`Failed to update last-activity for ${name}:`, err);
    });
}

/**
 * Delete pods that have been idle longer than the configured timeout.
 * Only deletes pods — PVCs are preserved.
 */
export async function deleteIdlePods(): Promise<void> {
  const cutoff = Date.now() - config.idleTimeoutMinutes * 60_000;

  try {
    const response = await k8sApi.listNamespacedPod({
      namespace: config.namespace,
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
    });

    for (const pod of response.items) {
      const lastActivity = pod.metadata?.annotations?.[ANNOTATION_LAST_ACTIVITY];
      if (!lastActivity) continue;

      const lastMs = new Date(lastActivity).getTime();
      if (lastMs < cutoff) {
        const name = pod.metadata?.name;
        if (!name) continue;
        console.log(`Deleting idle pod ${name} (last activity: ${lastActivity})`);
        await k8sApi
          .deleteNamespacedPod({ name, namespace: config.namespace })
          .catch((err) => console.error(`Failed to delete pod ${name}:`, err));

        // Clean up throttle entry
        const hash = pod.metadata?.labels?.[LABEL_USER_HASH];
        if (hash) activityThrottle.delete(hash);
      }
    }
  } catch (err) {
    console.error("Failed to list pods for idle cleanup:", err);
  }
}

function hasCode(err: unknown): err is { code: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "number"
  );
}

function isNotFound(err: unknown): boolean {
  return hasCode(err) && err.code === 404;
}

function isConflict(err: unknown): boolean {
  return hasCode(err) && err.code === 409;
}
