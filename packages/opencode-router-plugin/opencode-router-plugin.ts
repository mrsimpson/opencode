/**
 * opencode-router-plugin — single-file bundle for deployment via ConfigMap.
 *
 * This file is mounted into opencode pods at /home/opencode/.opencode/opencode-router-plugin.ts
 * and referenced from opencode.json as a local file plugin.
 *
 * No external imports — all types are inlined so the file is self-contained.
 * Loaded by opencode via bun at runtime.
 */

// ── Types (inlined from @opencode-ai/plugin to avoid import dependencies) ──

type PushEvent =
  | { type: "session.title"; sessionID: string; title: string }
  | { type: "message.user"; partID: string; messageID: string; sessionID: string; text: string; time: number }
  | { type: "message.assistant"; partID: string; messageID: string; sessionID: string; text: string; time: number }

// ── Push helper ──

async function pushEvent(event: PushEvent): Promise<void> {
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
    // Network errors are non-fatal — never crash the plugin
  }
}

// ── Plugin ──

// Map messageID → role for text part attribution (user message detection)
const messageRoles = new Map<string, "user" | "assistant">()

/**
 * Set of opencode session IDs this plugin is allowed to push events for.
 *
 * - null  = replay not yet complete (or fresh pod with no sessions) → accept all
 * - Set   = replay completed AND found ≥1 session → only those IDs are accepted
 *
 * On a fresh pod the replay finds zero sessions and leaves this null so the
 * first session.created event (the router-bootstrapped session) is not dropped.
 * Once that event fires we lock down to just that session ID.
 *
 * On a resumed pod the replay finds the existing sessions and populates the set
 * before any new events arrive — correct by construction.
 */
let allowedSessionIds: Set<string> | null = null

function isAllowed(sessionID: string): boolean {
  // null = replay not yet complete (or fresh pod); accept everything
  return allowedSessionIds === null || allowedSessionIds.has(sessionID)
}

function lockToSession(sessionID: string): void {
  if (allowedSessionIds === null) {
    allowedSessionIds = new Set([sessionID])
  } else {
    allowedSessionIds.add(sessionID)
  }
}

const RouterPlugin = async (input: any) => {
  // Startup replay: push all existing sessions/messages so the router recovers
  // state after a pod resume. The router deduplicates by partID — safe to replay.
  //
  // Runs *after* returning hooks (via setTimeout) so the server finishes
  // initialising and starts serving HTTP before we call input.client.
  // Without this delay, session.list() would call the server before it's ready,
  // creating a deadlock that prevents opencode from passing its readiness probe.
  setTimeout(async () => {
    try {
      const listResult = await input.client.session.list()
      const sessions: any[] = listResult.data ?? []

      // Lock down to sessions found at startup — only when sessions are present.
      // Fresh pods have zero sessions; leaving allowedSessionIds = null lets the
      // first session.created event (the router-bootstrapped session) be captured.
      if (sessions.length > 0) {
        allowedSessionIds = new Set(sessions.map((s: any) => s.id))
      }

      for (const session of sessions) {
        if (session.title) {
          await pushEvent({ type: "session.title", sessionID: session.id, title: session.title })
        }
        const msgResult = await input.client.session.messages({ path: { id: session.id } })
        const messages: any[] = msgResult.data ?? []
        for (const entry of messages) {
          const msg = entry.info
          const parts: any[] = entry.parts ?? []
          for (const part of parts) {
            if (part.type === "text" && (msg.role === "user" || msg.role === "assistant")) {
              await pushEvent({
                type: msg.role === "user" ? "message.user" : "message.assistant",
                partID: part.id,
                messageID: msg.id,
                sessionID: session.id,
                text: part.text ?? "",
                time: msg.time?.created ?? Date.now(),
              })
            }
          }
        }
      }
    } catch {
      // Replay failure is non-fatal — allowedSessionIds stays null (accept-all)
    }
  }, 5_000) // 5s delay — enough for opencode to finish initialising

  return {
    event: async ({ event }: { event: any }) => {
      const e = event as any
      if (e.type === "session.created" || e.type === "session.updated") {
        const title = e.properties?.info?.title
        const sessionID = e.properties?.sessionID ?? e.properties?.info?.id
        if (!sessionID) return
        // On a fresh pod allowedSessionIds is null — the first session.created
        // is the router-bootstrapped session; lock down to it immediately.
        if (e.type === "session.created") lockToSession(sessionID)
        if (title && isAllowed(sessionID)) {
          await pushEvent({ type: "session.title", sessionID, title })
        }
      }
      if (e.type === "message.updated") {
        const info = e.properties?.info
        if (info?.id && info?.role) messageRoles.set(info.id, info.role)
      }
      if (e.type === "message.part.updated") {
        const part = e.properties?.part
        if (part?.type === "text") {
          const sessionID = part.sessionID ?? e.properties?.sessionID
          const role = messageRoles.get(part.messageID)
          if (role === "user" && isAllowed(sessionID)) {
            await pushEvent({
              type: "message.user",
              partID: part.id,
              messageID: part.messageID,
              sessionID,
              text: part.text ?? "",
              time: e.properties?.time ?? Date.now(),
            })
          }
        }
      }
    },
    "experimental.text.complete": async (inp: any, output: any) => {
      if (!isAllowed(inp.sessionID)) return
      await pushEvent({
        type: "message.assistant",
        partID: inp.partID,
        messageID: inp.messageID,
        sessionID: inp.sessionID,
        text: output.text,
        time: Date.now(),
      })
    },
  }
}

export default { id: "opencode-router", server: RouterPlugin }
