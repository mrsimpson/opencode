/**
 * Format an ISO date string as locale date + time.
 * Uses the browser's locale via `Intl.DateTimeFormat`.
 */
export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
}

type Session = { hash: string; state: "creating" | "running" | "stopped"; lastActivity: string }

/**
 * Sort and group sessions: active (creating/running) first, then stopped.
 * Within each group sorted by lastActivity descending (most recent first).
 */
export function sortedAndGroupedSessions<T extends Session>(sessions: T[]): { active: T[]; stopped: T[] }
/**
 * Sort and group sessions into three groups for the sidebar:
 * - current: the single session matching activeHash (shown first)
 * - active: other active (creating/running) sessions
 * - stopped: stopped sessions
 * Within active/stopped, sorted by lastActivity descending.
 */
export function sortedAndGroupedSessions<T extends Session>(
  sessions: T[],
  activeHash: string | undefined,
): { current: T[]; active: T[]; stopped: T[] }
export function sortedAndGroupedSessions<T extends Session>(
  sessions: T[],
  activeHash?: string | undefined,
): { current: T[]; active: T[]; stopped: T[] } | { active: T[]; stopped: T[] } {
  const byLastActivity = (a: T, b: T) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  if (activeHash !== undefined) {
    const current = sessions.filter((s) => s.hash === activeHash)
    const rest = sessions.filter((s) => s.hash !== activeHash)
    return {
      current,
      active: rest.filter((s) => s.state !== "stopped").sort(byLastActivity),
      stopped: rest.filter((s) => s.state === "stopped").sort(byLastActivity),
    }
  }
  return {
    active: sessions.filter((s) => s.state !== "stopped").sort(byLastActivity),
    stopped: sessions.filter((s) => s.state === "stopped").sort(byLastActivity),
  }
}

export type IdleLabels = {
  stopsIn: (minutes: number) => string
  stoppedOn: (date: string) => string
  stoppingSoon: string
}

/**
 * Compute idle status label for a session.
 * - stopped state: "stopped on <date>"
 * - running/creating with time remaining: "stops in ~Xm"
 * - running/creating past timeout: "stopping soon"
 *
 * Labels are injected so this function stays pure and locale-independent.
 */
export function computeIdleStatus(
  state: "creating" | "running" | "stopped",
  lastActivity: string,
  idleTimeoutMinutes: number,
  labels: IdleLabels,
): { stopsInMinutes: number | null; stoppedMinutesAgo: number | null; label: string } {
  if (state === "stopped") {
    const date = new Date(lastActivity).toLocaleDateString(undefined, {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    })
    return { stopsInMinutes: null, stoppedMinutesAgo: null, label: labels.stoppedOn(date) }
  }
  const elapsed = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 60_000)
  const remaining = idleTimeoutMinutes - elapsed
  if (remaining >= 0) {
    return { stopsInMinutes: remaining, stoppedMinutesAgo: null, label: labels.stopsIn(remaining) }
  }
  return { stopsInMinutes: null, stoppedMinutesAgo: 0, label: labels.stoppingSoon }
}

/**
 * Determine the app phase kind after restoring from URL or popstate.
 *
 * After resuming a stopped session, always return "creating" to trigger
 * LoadingScreen polling until the session is ready.
 *
 * For non-stopped sessions (not resumed), use the session URL to determine
 * the phase: "creating" if URL is null (not yet resolved), otherwise "open".
 */
export function getPhaseKindAfterUrlRestore(wasResumed: boolean, sessionUrl: string | null): "creating" | "open" {
  if (wasResumed || sessionUrl === null) {
    return "creating"
  }
  return "open"
}
