import { For, Show } from "solid-js"
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
                trailing={
                  <div class="flex items-center gap-2 shrink-0 self-start mt-1">
                    <button
                      class="opacity-0 group-hover:opacity-100 text-12-regular px-2 py-1 rounded"
                      style={{
                        background: "none",
                        border: "1px solid var(--border-base)",
                        cursor: "pointer",
                        color: props.terminating.has(session.hash)
                          ? "var(--text-dimmed-base)"
                          : "var(--text-danger-base, #ef4444)",
                      }}
                      disabled={props.terminating.has(session.hash)}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onTerminateSession(session)
                      }}
                      title={t("session.action.terminate")}
                    >
                      {props.terminating.has(session.hash) ? t("session.action.terminating") : "✕"}
                    </button>
                    <Show when={session.state !== "creating"}>
                      <span style={{ color: "var(--icon-base)" }}>→</span>
                    </Show>
                  </div>
                }
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
