/** Events pushed from the opencode-router-plugin inside a pod to the router. */
export type ProgressPushEvent =
  | { type: "session.title"; sessionID: string; title: string }
  | { type: "message.user"; partID: string; messageID: string; sessionID: string; text: string; time: number }
  | { type: "message.assistant"; partID: string; messageID: string; sessionID: string; text: string; time: number }

/** One stored text message (user or assistant). */
export type StoredMessage = {
  partID: string
  messageID: string
  sessionID: string
  role: "user" | "assistant"
  text: string
  time: number
}

/** Per-session progress state stored in the router. */
export type SessionProgress = {
  title?: string
  messages: StoredMessage[]
}
