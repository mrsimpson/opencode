import { Show, createSignal } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { Portal } from "solid-js/web"
import type { Session } from "./api"
import { useT } from "./i18n"
import { StatusDot } from "./status-dot"
import { computeIdleStatus } from "./session-utils"

export function computeRelativeAge(lastActivity: string) {
  const diffMs = Date.now() - new Date(lastActivity).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function stripRepoUrl(repoUrl: string) {
  return repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
}

/**
 * Human-readable repo label for a session:
 * - Always strips the server (e.g. "github.com")
 * - Strips the owner segment when it matches the email username (part before "@")
 */
export function repoLabel(repoUrl: string, email: string) {
  const stripped = stripRepoUrl(repoUrl)
  const parts = stripped.split("/")
  const withoutServer = parts.slice(1) // ["owner", "repo"]
  const username = email.split("@")[0] ?? ""
  if (username && withoutServer[0]?.toLowerCase() === username.toLowerCase()) {
    return withoutServer.slice(1).join("/") || withoutServer.join("/")
  }
  return withoutServer.join("/")
}

type Props = {
  session: Session
  /** compact = sidebar variant */
  compact?: boolean
  active?: boolean
  onClick?: () => void
  trailing?: any
}

export function SessionItem(props: Props) {
  const t = useT(useI18n())
  const repo = () => stripRepoUrl(props.session.repoUrl)
  const name = () => repoLabel(props.session.repoUrl, props.session.email)
  const created = () => computeRelativeAge(props.session.createdAt)
  const clickable = () => props.session.state !== "creating"

  const idle = () =>
    computeIdleStatus(props.session.state, props.session.lastActivity, props.session.idleTimeoutMinutes, {
      stopsIn: (m) => t("session.idle.stopsIn", { minutes: m }),
      stoppedOn: (d) => t("session.idle.stoppedOn", { date: d }),
      stoppingSoon: t("session.idle.stoppingSoon"),
    })

  /** Second line for compact variant */
  const compactMeta = () =>
    props.session.state === "stopped" ? `stopped ${formatDate(props.session.lastActivity)}` : `started ${created()}`

  return (
    <Show
      when={props.compact}
      fallback={
        /* ── FULL (main list) variant ── */
        <div
          class="flex items-center gap-3 px-4 py-3 group"
          style={{
            cursor: clickable() ? "pointer" : "default",
            background: props.active ? "var(--background-highlight)" : undefined,
          }}
          onClick={() => clickable() && props.onClick?.()}
        >
          {/* Status dot — far left */}
          <div class="shrink-0 self-start mt-1">
            <StatusDot state={props.session.state} />
          </div>

          {/* Left: repo + message */}
          <div class="flex flex-col flex-1 min-w-0">
            <p class="text-13-medium truncate" style={{ color: "var(--text-base)" }}>
              {repo()}
            </p>
            <Show when={props.session.description}>
              <p class="text-12-regular truncate" style={{ color: "var(--text-dimmed-base)" }}>
                {props.session.description}
              </p>
            </Show>
          </div>

          {/* Right: created + idle label */}
          <div class="shrink-0 flex flex-col items-end gap-0.5">
            <p class="text-11-regular" style={{ color: "var(--text-dimmed-base)" }}>
              {created()}
            </p>
            <p class="text-11-regular" style={{ color: "var(--text-dimmed-base)" }}>
              {idle().label}
            </p>
          </div>

          {props.trailing}
        </div>
      }
    >
      <CompactSessionItem
        session={props.session}
        name={name()}
        compactMeta={compactMeta()}
        active={props.active}
        clickable={clickable()}
        trailing={props.trailing}
        onClick={props.onClick}
      />
    </Show>
  )
}

/** Separate component so it can have its own hover state signals */
function CompactSessionItem(props: {
  session: Session
  name: string
  compactMeta: string
  active?: boolean
  clickable: boolean
  trailing?: any
  onClick?: () => void
}) {
  const [tooltipPos, setTooltipPos] = createSignal<{ top: number; left: number } | null>(null)
  let rowRef: HTMLDivElement | undefined

  const showTooltip = () => {
    if (!rowRef || !props.session.description) return
    const rect = rowRef.getBoundingClientRect()
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 8 })
  }

  const hideTooltip = () => setTooltipPos(null)

  return (
    <div
      ref={rowRef}
      class="flex items-center gap-2 px-2 py-1.5 rounded-md"
      style={{
        cursor: props.clickable ? "pointer" : "default",
        background: props.active ? "var(--background-highlight)" : undefined,
      }}
      onClick={() => props.clickable && props.onClick?.()}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      <StatusDot state={props.session.state} />

      <div class="flex flex-col flex-1 min-w-0">
        <p class="text-12-regular truncate" style={{ color: "var(--text-base)" }}>
          {props.name}
        </p>
        <p class="text-11-regular truncate" style={{ color: "var(--text-dimmed-base)" }}>
          {props.compactMeta}
        </p>
      </div>

      {props.trailing}

      {/* Fixed-position tooltip rendered into document.body to escape overflow:hidden parents */}
      <Show when={tooltipPos() !== null && props.session.description}>
        <Portal>
          <div
            class="pointer-events-none fixed z-[9999] text-12-regular rounded-lg px-3 py-2 max-w-64 shadow-lg"
            style={{
              top: `${tooltipPos()!.top}px`,
              left: `${tooltipPos()!.left}px`,
              transform: "translateY(-50%)",
              background: "var(--surface-float-base)",
              color: "var(--text-invert-base)",
              border: "none",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {props.session.description}
          </div>
        </Portal>
      </Show>
    </div>
  )
}
