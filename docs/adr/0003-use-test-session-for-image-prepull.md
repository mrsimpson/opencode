# 3. Use Test Session for Image Pre-pull

## Status

Accepted

## Context

When a new container image is published (e.g., after CI builds), new sessions via the opencode router experience long cold starts because Kubernetes needs to pull the new image. We need a mechanism to pre-pull images after CI builds them.

Two approaches were considered:

1. **DaemonSet Approach**: Create a DaemonSet with initContainer that forces image pull on all nodes, wait for rollout, then delete.
2. **Test Session Approach**: Create a test session using existing pod-manager logic, wait for it to become healthy (which means the image is pulled and runs correctly), then delete the session.

The cluster is a **single-node cluster**, meaning there is only one node where pods can be scheduled.

## Decision

We will use the **Test Session Approach** for image pre-pulling:

1. Add a `POST /api/admin/pull-image` endpoint that accepts `{ "image": "repo:tag" }`
2. The endpoint will:
   - Update the router config to use the new image (or accept it as parameter)
   - Create a test session using existing `ensurePod()` logic with the new image
   - Wait for the session pod to become "running" (readiness probe passes)
   - This inherently performs a **smoke test** - if opencode doesn't start, the pod won't become healthy
   - Once healthy, delete the test session (pod + PVC)
   - Return success response

3. No need for DaemonSet, Jobs, or additional Kubernetes API clients (BatchV1Api, AppsV1Api)

## Consequences

### Positive

- **Simpler implementation**: Reuses existing `ensurePod()`, `getPodState()`, and `terminateSession()` functions
- **Built-in smoke test**: The readiness probe checks `/health` endpoint - if opencode doesn't start, the pod won't become healthy
- **Less code**: No need to manage DaemonSets, Jobs, or add new K8s API clients
- **Consistent with existing patterns**: Uses the same pod specification as real sessions
- **Automatic cleanup**: Can reuse `terminateSession()` to clean up the test session

### Negative

- **Single-node only**: This approach only pulls the image on one node. It won't work for multi-node clusters.
- **Slightly slower**: Creating a full session pod takes longer than just pulling an image (but provides smoke test)

### Future Considerations

If the cluster becomes multi-node in the future, we could:

- Add a DaemonSet-based approach for multi-node pre-pulling
- Create multiple test sessions with `nodeName` targeting each node
- Document that the current approach is single-node only
