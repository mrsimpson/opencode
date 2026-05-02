/** Wire format for events pushed from plugin to router (duplicated from router — no shared dep) */
export type ProgressPushEvent =
  | { type: "session.title"; sessionID: string; title: string }
  | { type: "message.user"; partID: string; messageID: string; sessionID: string; text: string; time: number }
  | { type: "message.assistant"; partID: string; messageID: string; sessionID: string; text: string; time: number }
