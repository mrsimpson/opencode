import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog, useI18n } from "@opencode-ai/ui/context"
import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { type Session, listSessions, resumeSession, terminateSession } from "./api"
import { useT } from "./i18n"
import { LoadingScreen } from "./loading-screen"
import { computeIdleStatus } from "./session-utils"
import { SetupForm } from "./setup-form"

type Phase =
  | { kind: "loading" }
  | { kind: "list"; sessions: Session[]; email: string }
  | { kind: "new-session"; email: string }
  | { kind: "creating"; hash: string; url: string }
  | { kind: "error"; message: string }

export function App() {
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" })
  const [terminating, setTerminating] = createSignal<Set<string>>(new Set())
  const dialog = useDialog()
  const t = useT(useI18n())

  const loadSessions = async () => {
    try {
      const { email, sessions } = await listSessions()
      setPhase({ kind: "list", sessions, email })
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : t("app.error.connect"),
      })
    }
  }

  const pollSessions = () => {
    // Only refresh the list when we're actually showing the list — never interrupt
    // the LoadingScreen (creating phase) which manages its own redirect loop.
    const p = phase()
    if (p.kind === "list" || p.kind === "loading") loadSessions()
  }

  onMount(() => {
    loadSessions()
    const timer = setInterval(pollSessions, 5_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="flex items-center justify-center min-h-dvh p-6" style={{ background: "var(--background-base)" }}>
      <div class="flex flex-col items-center gap-8 w-full" style={{ "max-width": "28rem" }}>
        <Logo class="h-7" />

        <Switch>
          <Match when={phase().kind === "loading"}>
            <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
              {t("app.loading")}
            </p>
          </Match>

          <Match when={phase().kind === "list" && (phase() as Extract<Phase, { kind: "list" }>)}>
            {(p) => (
              <div class="flex flex-col gap-6 w-full">
                <div class="flex flex-col gap-1">
                  <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                    {t("app.signedInAs", { email: p().email || "—" })}
                  </p>
                </div>

                <Show when={p().sessions.length > 0}>
                  <div class="flex flex-col gap-2">
                    <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                      {t("app.yourSessions")}
                    </p>
                    <For each={p().sessions}>
                      {(session) => {
                        const idle = computeIdleStatus(
                          session.state,
                          session.lastActivity,
                          session.idleTimeoutMinutes,
                          {
                            stopsIn: (m) => t("session.idle.stopsIn", { minutes: m }),
                            stoppedOn: (d) => t("session.idle.stoppedOn", { date: d }),
                            stoppingSoon: t("session.idle.stoppingSoon"),
                          },
                        )
                        const handleTerminate = (e: MouseEvent) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const hash = session.hash
                          const repo = session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
                          dialog.show(() => (
                            <Dialog
                              fit
                              title={t("session.terminate.title")}
                              description={t("session.terminate.description", { repo })}
                            >
                              <div class="flex justify-end gap-2 p-4 pt-2">
                                <Button variant="secondary" size="small" onClick={() => dialog.close()}>
                                  {t("session.action.cancel")}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="small"
                                  style={{ color: "var(--text-danger-base, #ef4444)" }}
                                  onClick={async () => {
                                    dialog.close()
                                    setTerminating((prev) => new Set([...prev, hash]))
                                    await terminateSession(hash)
                                    setTerminating((prev) => {
                                      const next = new Set(prev)
                                      next.delete(hash)
                                      return next
                                    })
                                    loadSessions()
                                  }}
                                >
                                  {t("session.action.terminate")}
                                </Button>
                              </div>
                            </Dialog>
                          ))
                        }
                        const handleResume = async (e: MouseEvent) => {
                          e.preventDefault()
                          e.stopPropagation()
                          await resumeSession(session.hash)
                          setPhase({ kind: "creating", hash: session.hash, url: session.url })
                        }
                        const cardStyle = {
                          background: "var(--background-surface)",
                          "border-color": "var(--border-base)",
                          "text-decoration": "none",
                        }
                        const inner = (
                          <div class="flex items-center justify-between">
                            <div class="flex flex-col gap-1">
                              <p class="text-13-medium" style={{ color: "var(--text-base)" }}>
                                {session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")}
                              </p>
                              <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                                {session.branch}
                                {session.state !== "stopped"
                                  ? ` · ${t(`session.state.${session.state}` as "session.state.creating")} · ${idle.label}`
                                  : ` · ${idle.label}`}
                              </p>
                            </div>
                            <div class="flex gap-2">
                              <Show when={session.state === "stopped"}>
                                <Button variant="secondary" size="small" onClick={handleResume}>
                                  {t("session.action.resume")}
                                </Button>
                              </Show>
                              <Button
                                variant="secondary"
                                size="small"
                                disabled={terminating().has(session.hash)}
                                onClick={handleTerminate}
                              >
                                {terminating().has(session.hash)
                                  ? t("session.action.terminating")
                                  : t("session.action.terminate")}
                              </Button>
                            </div>
                          </div>
                        )
                        return session.state === "stopped" ? (
                          <div class="flex flex-col gap-2 p-3 rounded-lg border" style={cardStyle}>
                            {inner}
                          </div>
                        ) : (
                          <a href={session.url} class="flex flex-col gap-2 p-3 rounded-lg border" style={cardStyle}>
                            {inner}
                          </a>
                        )
                      }}
                    </For>
                  </div>
                </Show>

                <Button
                  variant="primary"
                  size="large"
                  onClick={() => setPhase({ kind: "new-session", email: p().email })}
                >
                  {t("app.newSession")}
                </Button>
              </div>
            )}
          </Match>

          <Match when={phase().kind === "new-session" && (phase() as Extract<Phase, { kind: "new-session" }>)}>
            {(p) => (
              <div class="flex flex-col gap-4 w-full">
                <button
                  onClick={loadSessions}
                  class="text-12-regular self-start"
                  style={{
                    color: "var(--text-dimmed-base)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {t("app.back")}
                </button>
                <SetupForm email={p().email} onCreated={(hash, url) => setPhase({ kind: "creating", hash, url })} />
              </div>
            )}
          </Match>

          <Match when={phase().kind === "creating" && (phase() as Extract<Phase, { kind: "creating" }>)}>
            {(p) => <LoadingScreen hash={p().hash} url={p().url} />}
          </Match>

          <Match when={phase().kind === "error" && (phase() as Extract<Phase, { kind: "error" }>)}>
            {(p) => (
              <p class="text-14-medium" style={{ color: "var(--text-danger-base, #ef4444)" }}>
                {p().message}
              </p>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
