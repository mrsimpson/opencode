import { For, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import type { Session } from "./api"
import { useT } from "./i18n"
import { StatusDot } from "./status-dot"

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  sessions: Session[]
  email: string
  onNewSession: () => void
  onOpenSession: (session: Session) => void
  onResumeSession: (session: Session) => void
  onTerminateSession: (session: Session) => void
}

const sidebarBase = {
  background: "var(--background-surface)",
  "border-right": "1px solid var(--border-base)",
  "flex-shrink": "0",
}

export function SessionSidebar(props: Props) {
  const t = useT(useI18n())

  return (
    <Show
      when={!props.collapsed}
      fallback={
        <aside class="flex flex-col items-center py-4 w-12" style={sidebarBase}>
          <button
            title={t("sidebar.expand")}
            onClick={props.onToggleCollapse}
            class="size-8 flex items-center justify-center rounded"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--icon-base)" }}
          >
            ›
          </button>
        </aside>
      }
    >
      <aside class="flex flex-col w-56 py-4 gap-4 overflow-hidden" style={sidebarBase}>
        <div class="flex items-center justify-between px-3">
          <span class="text-13-medium" style={{ color: "var(--text-base)" }}>
            OpenCode
          </span>
          <button
            title={t("sidebar.collapse")}
            onClick={props.onToggleCollapse}
            class="size-6 flex items-center justify-center rounded"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--icon-base)" }}
          >
            ‹
          </button>
        </div>

        <div class="px-3">
          <button
            onClick={props.onNewSession}
            class="w-full text-12-medium py-2 px-3 rounded-lg text-left"
            style={{
              background: "var(--background-highlight)",
              border: "1px solid var(--border-base)",
              cursor: "pointer",
              color: "var(--text-base)",
            }}
          >
            + {t("app.newSession")}
          </button>
        </div>

        <Show when={props.sessions.length > 0}>
          <div class="flex flex-col gap-1 px-2 overflow-y-auto flex-1">
            <p class="text-11-regular px-1 mb-1" style={{ color: "var(--text-dimmed-base)" }}>
              {t("app.recents")}
            </p>
            <For each={props.sessions}>
              {(session) => (
                <div class="group flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ position: "relative" }}>
                  <StatusDot state={session.state} />
                  <button
                    class="flex-1 text-12-regular text-left truncate min-w-0"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: session.state === "creating" ? "default" : "pointer",
                      color: "var(--text-base)",
                      padding: 0,
                    }}
                    onClick={() => {
                      if (session.state === "stopped") props.onResumeSession(session)
                      else if (session.state === "running") props.onOpenSession(session)
                    }}
                  >
                    {session.branch}
                  </button>
                  {/* Delete button — visible on hover */}
                  <button
                    class="opacity-0 group-hover:opacity-100 text-12-regular px-1"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-danger-base, #ef4444)",
                      "flex-shrink": "0",
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onTerminateSession(session)
                    }}
                    title={t("session.action.terminate")}
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
