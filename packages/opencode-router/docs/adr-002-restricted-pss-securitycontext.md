# ADR-002: Restricted PSS SecurityContext for User Pods

**Status:** Accepted  
**Date:** 2026-04-03

## Context

The `opencode-router` dynamically creates Kubernetes Pods for each authenticated user (see ADR-001). The original `pod-manager.ts` implementation created these pods without any `securityContext`, meaning:

- Pods ran as whatever user the container image specified (typically root)
- No privilege escalation restrictions were in place
- Linux capabilities were unrestricted
- The namespace Pod Security Standards (PSS) level could not be set to `restricted`
- PVCs mounted at `/root` would be owned by root (UID 0), preventing write access by UID 1000

When deploying to a homelab Kubernetes cluster that enforces PSS `restricted` at the namespace level, pods without securityContext would be rejected by the admission controller.

Additionally, the OpenCode container image used in this deployment (`ghcr.io/mrsimpson/opencode`) runs the `opencode` binary as UID 1000. Without `fsGroup: 1000` in the pod-level securityContext, a PVC mounted at `/root` would be owned by root and the opencode process could not write to it.

## Decision

We add explicit `securityContext` blocks to all containers in the user pod spec (in `pod-manager.ts`):

### Pod-level securityContext

```typescript
securityContext: {
  runAsUser: 1000,
  runAsGroup: 1000,
  fsGroup: 1000,        // Makes PVC owned by GID 1000 on mount
  runAsNonRoot: true,
}
```

### Main container (`opencode`) securityContext

```typescript
securityContext: {
  allowPrivilegeEscalation: false,
  runAsNonRoot: true,
  capabilities: { drop: ["ALL"] },
  seccompProfile: { type: "RuntimeDefault" },
}
```

### Init container (`git-init`) securityContext

```typescript
securityContext: {
  runAsUser: 1000,
  runAsGroup: 1000,
  allowPrivilegeEscalation: false,
  runAsNonRoot: true,
  capabilities: { drop: ["ALL"] },
}
```

The `git-init` container uses `alpine/git` which does not have a pre-built seccomp profile; `RuntimeDefault` is not added to avoid compatibility issues with the Alpine image.

## Alternatives Considered

### A. Use namespace PSS `privileged` or `baseline`

**Rejected.** Weaker PSS levels allow privilege escalation and do not enforce non-root execution. This is unnecessary for workloads that are fully capable of running as non-root. `restricted` is the secure default; relaxing it should require a strong justification.

### B. Use an init container to `chown` the PVC after mount

```dockerfile
# init container runs as root, chowns /root to 1000:1000, then main container runs as 1000
```

**Rejected.** This requires the init container to run as root (`runAsUser: 0`), which violates `restricted` PSS. Using `fsGroup: 1000` achieves the same result (PVC accessible by GID 1000) via the kubelet without requiring a privileged init container.

### C. Build the image to run as root, handle permissions at runtime

**Rejected.** Running as root in production violates least-privilege principles and fails `restricted` PSS. The homelab image (`ghcr.io/mrsimpson/opencode`) already runs as UID 1000; this is the correct foundation to build on.

## Consequences

### Positive
- User pods are fully compliant with Kubernetes PSS `restricted` level
- The `opencode-router` namespace can be labeled `pod-security.kubernetes.io/enforce: restricted`
- PVCs mounted at `/root` are writable by UID 1000 via `fsGroup: 1000`
- No Linux capabilities are granted to user pods
- Seccomp profile `RuntimeDefault` limits syscall surface for the main container
- All containers run as non-root (UID 1000), matching the homelab image

### Negative
- The `alpine/git` init container must also run as UID 1000. If the git remote requires SSH keys (which are typically root-owned), additional setup may be needed. For HTTPS git clones (the primary use case), UID 1000 is sufficient.
- The `RuntimeDefault` seccomp profile is not applied to `git-init` (Alpine compatibility); a future improvement could pin a specific seccomp profile.

### Risks
- **Alpine/git UID 1000:** The `alpine/git` image has a user with UID 1000 (`git` user on some versions). If the image creates files as a different UID internally before the securityContext takes effect, this could cause issues. Mitigation: test with the specific `alpine/git:latest` tag; switch to a digest-pinned tag if behavior is inconsistent.
