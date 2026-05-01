import type { Plugin } from "@opencode-ai/plugin"
import { pushEvent } from "./plugin.js"

// Map messageID → role for text part attribution
const messageRoles = new Map<string, "user" | "assistant">()

const RouterPlugin: Plugin = async (input) => {
  // Startup replay: push all existing sessions/messages so router recovers state after pod resume.
  // This is idempotent — the router deduplicates by partID.
  try {
    const listResult = await input.client.session.list()
    const sessions = listResult.data ?? []
    for (const session of sessions) {
      if (session.title) {
        await pushEvent({ type: "session.title", sessionID: session.id, title: session.title })
      }
      const msgResult = await input.client.session.messages({ path: { id: session.id } })
      const messages = msgResult.data ?? []
      for (const entry of messages) {
        const msg = entry.info
        for (const part of (entry as any).parts ?? []) {
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
    // Replay failure is non-fatal — hooks still register
  }

  return {
    event: async ({ event }) => {
      const e = event as any
      if (e.type === "session.created" || e.type === "session.updated") {
        const title = e.properties?.info?.title
        const sessionID = e.properties?.sessionID ?? e.properties?.info?.id
        if (title && sessionID) await pushEvent({ type: "session.title", sessionID, title })
      }
      if (e.type === "message.updated") {
        const info = e.properties?.info
        if (info?.id && info?.role) messageRoles.set(info.id, info.role)
      }
      if (e.type === "message.part.updated") {
        const part = e.properties?.part
        if (part?.type === "text") {
          const role = messageRoles.get(part.messageID)
          if (role === "user") {
            await pushEvent({
              type: "message.user",
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID ?? e.properties?.sessionID,
              text: part.text ?? "",
              time: e.properties?.time ?? Date.now(),
            })
          }
        }
      }
    },
    "experimental.text.complete": async (inp, output) => {
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
