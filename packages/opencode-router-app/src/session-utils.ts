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
