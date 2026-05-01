import type { ProgressPushEvent } from "./types.js"

export async function pushEvent(event: ProgressPushEvent): Promise<void> {
  const routerUrl = process.env.OPENCODE_ROUTER_URL
  const hash = process.env.OPENCODE_SESSION_HASH
  const secret = process.env.OPENCODE_POD_SECRET
  if (!routerUrl || !hash || !secret) return
  try {
    await fetch(`${routerUrl}/api/sessions/${hash}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pod-secret": secret,
      },
      body: JSON.stringify(event),
    })
  } catch {
    // Network errors are non-fatal — don't crash the plugin
  }
}
