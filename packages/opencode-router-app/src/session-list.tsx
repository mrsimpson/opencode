import { For, Show, createSignal } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import type { Session } from "./api"
import { useT } from "./i18n"
import { SessionItem } from "./session-item"

type Props = {
  sessions: Session[]
  terminating: Set<string>
  onOpenSession: (session: Session) => void
  onResumeSession: (session: Session) => void
  onTerminateSession: (session: Session) => void
}

export function SessionList(props: Props) {
  const t = useT(useI18n())
  const [expandedHash, setExpandedHash] = createSignal<string | null>(null)

  const toggleExpand = (hash: string) => setExpandedHash((prev) => (prev === hash ? null : hash))

  return (
    <Show when={props.sessions.length > 0}>
      <div
        class="rounded-xl border overflow-hidden"
        style={{ background: "var(--background-surface)", "border-color": "var(--border-base)" }}
      >
        <div class="px-4 py-3 border-b" style={{ "border-color": "var(--border-base)" }}>
          <p class="text-12-medium" style={{ color: "var(--text-dimmed-base)" }}>
            {t("app.sessions")}
          </p>
        </div>
        <For each={props.sessions}>
          {(session, i) => (
            <div style={{ "border-top": i() > 0 ? "1px solid var(--border-base)" : "none" }}>
              <SessionItem
                session={session}
                onClick={() => {
                  if (session.state === "stopped") props.onResumeSession(session)
                  else if (session.state === "running") props.onOpenSession(session)
                }}
                expanded={expandedHash() === session.hash}
                onToggleExpand={() => toggleExpand(session.hash)}
                onTerminate={() => props.onTerminateSession(session)}
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
