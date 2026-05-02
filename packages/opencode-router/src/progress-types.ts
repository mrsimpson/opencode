import { z } from "zod"

/** Events pushed from the opencode-router-plugin inside a pod to the router. */
export const ProgressPushEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.title"),
    sessionID: z.string().min(1),
    title: z.string(),
  }),
  z.object({
    type: z.literal("message.user"),
    partID: z.string().min(1),
    messageID: z.string().min(1),
    sessionID: z.string().min(1),
    text: z.string(),
    time: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("message.assistant"),
    partID: z.string().min(1),
    messageID: z.string().min(1),
    sessionID: z.string().min(1),
    text: z.string(),
    time: z.number().int().nonnegative(),
  }),
])

export type ProgressPushEvent = z.infer<typeof ProgressPushEventSchema>

/** One stored text message (user or assistant). */
export const StoredMessageSchema = z.object({
  partID: z.string().min(1),
  messageID: z.string().min(1),
  sessionID: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  time: z.number().int().nonnegative(),
})

export type StoredMessage = z.infer<typeof StoredMessageSchema>

/** Per-session progress state stored in the router. */
export const SessionProgressSchema = z.object({
  title: z.string().optional(),
  messages: z.array(StoredMessageSchema),
})

export type SessionProgress = z.infer<typeof SessionProgressSchema>
