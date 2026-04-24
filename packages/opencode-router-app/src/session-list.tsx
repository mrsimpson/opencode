import { For, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import type { Session } from "./api"
import { useT } from "./i18n"
import { StatusDot } from "./status-dot"
import { computeIdleStatus } from "./session-utils"

type Props = {
  sessions: Session[]
  terminating: Set<string>
  onOpenSession: (session: Session) => void
  onResumeSession: (session: Session) => void
  onTerminateSession: (session: Session) => void
}

function computeRelativeAge(lastActivity: string) {
  const diffMs = Date.now() - new Date(lastActivity).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

const cardStyle = {
  background: "var(--background-surface)",
  "border-color": "var(--border-base)",
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
          {(session, i) => {
            const idle = computeIdleStatus(session.state, session.lastActivity, session.idleTimeoutMinutes, {
              stopsIn: (m) => t("session.idle.stopsIn", { minutes: m }),
              stoppedOn: (d) => t("session.idle.stoppedOn", { date: d }),
              stoppingSoon: t("session.idle.stoppingSoon"),
            })
            const repo = session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
            const clickable = session.state !== "creating"
            return (
              <div
                class="flex items-center gap-3 px-4 py-3 group"
                style={{
                  "border-top": i() > 0 ? "1px solid var(--border-base)" : "none",
                  cursor: clickable ? "pointer" : "default",
                }}
                onClick={() => {
                  if (session.state === "stopped") props.onResumeSession(session)
                  else if (session.state === "running") props.onOpenSession(session)
                }}
              >
                <StatusDot state={session.state} />
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <p class="text-13-medium truncate" style={{ color: "var(--text-base)" }}>
                    {session.branch}
                  </p>
                  <Show when={session.description}>
                    <p class="text-12-regular truncate" style={{ color: "var(--text-dimmed-base)" }}>
                      {session.description}
                    </p>
                  </Show>
                  <p class="text-11-regular" style={{ color: "var(--text-dimmed-base)" }}>
                    {repo} · {computeRelativeAge(session.lastActivity)} · {idle.label}
                  </p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
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
                  <Show when={clickable}>
                    <span style={{ color: "var(--icon-base)" }}>→</span>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
