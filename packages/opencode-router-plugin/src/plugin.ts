import type { ProgressPushEvent } from "./types.js"

let warnedMissingEnv = false

export async function pushEvent(event: ProgressPushEvent): Promise<void> {
  const routerUrl = process.env.OPENCODE_ROUTER_URL
  const hash = process.env.OPENCODE_SESSION_HASH
  const secret = process.env.OPENCODE_POD_SECRET
  if (!routerUrl || !hash || !secret) {
    // Warn once so misconfigured pods are visible in the log without spamming
    // every event. Subsequent calls stay silent.
    if (!warnedMissingEnv) {
      warnedMissingEnv = true
      console.warn(
        "opencode-router-plugin: OPENCODE_ROUTER_URL, OPENCODE_SESSION_HASH, or OPENCODE_POD_SECRET is unset; pushEvent disabled.",
      )
    }
    return
  }
  try {
    const res = await fetch(`${routerUrl}/api/sessions/${hash}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pod-secret": secret,
      },
      body: JSON.stringify(event),
    })
    if (!res.ok) {
      console.warn(`opencode-router-plugin: pushEvent ${event.type} → HTTP ${res.status}`)
    }
  } catch (err) {
    // Network errors are non-fatal — don't crash the plugin, but surface them.
    console.warn(`opencode-router-plugin: pushEvent ${event.type} failed:`, err)
  }
}
