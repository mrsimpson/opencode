import { For, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { Button } from "@opencode-ai/ui/button"
import type { Session } from "./api"
import { useT } from "./i18n"
import { SessionItem } from "./session-item"

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  sessions: Session[]
  email: string
  activeHash?: string
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
      <aside class="flex flex-col w-56 py-4 gap-4" style={{ ...sidebarBase, overflow: "visible" }}>
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
          <Button onClick={props.onNewSession} icon="plus" variant="secondary" class="w-full">
            {t("app.newSession")}
          </Button>
        </div>

        <Show when={props.sessions.length > 0}>
          <div class="flex flex-col gap-0.5 px-1 overflow-y-auto flex-1">
            <p class="text-11-regular px-2 mb-1" style={{ color: "var(--text-dimmed-base)" }}>
              {t("app.recents")}
            </p>
            <For each={props.sessions}>
              {(session) => (
                <SessionItem
                  session={session}
                  compact
                  active={props.activeHash === session.hash}
                  onClick={() => {
                    if (session.state === "stopped") props.onResumeSession(session)
                    else if (session.state === "running") props.onOpenSession(session)
                  }}
                  trailing={
                    <button
                      class="opacity-0 group-hover:opacity-100 text-12-regular px-1 shrink-0"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-danger-base, #ef4444)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onTerminateSession(session)
                      }}
                      title={t("session.action.terminate")}
                    >
                      ✕
                    </button>
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
