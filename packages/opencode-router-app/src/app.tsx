import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog, useI18n } from "@opencode-ai/ui/context"
import { Match, Show, Switch, createSignal, onCleanup, onMount, batch } from "solid-js"
import {
  type Session,
  createNewProjectSession,
  createSession,
  resumeSession,
  subscribeSessionsStream,
  suggestBranch,
  terminateSession,
} from "./api"
import { useT } from "./i18n"
import { LoadingScreen } from "./loading-screen"
import { SessionInputBar } from "./session-input-bar"
import { SessionList } from "./session-list"
import { SessionSidebar } from "./session-sidebar"
import { buildNewProjectKey, buildSessionKey, GIT_URL_PATTERN } from "./setup-form-utils"
import { getPhaseKindAfterUrlRestore } from "./session-utils"

type AppPhase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "creating"; hash: string }
  | { kind: "open"; hash: string; url: string }
  | { kind: "error"; message: string }

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [appPhase, setAppPhase] = createSignal<AppPhase>({ kind: "loading" })
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [email, setEmail] = createSignal("")
  const [terminating, setTerminating] = createSignal<Set<string>>(new Set())

  const [repoUrl, setRepoUrl] = createSignal("")
  const [sourceBranch, setSourceBranch] = createSignal("")
  const [sessionBranch, setSessionBranch] = createSignal("")
  const [activeTab, setActiveTab] = createSignal<"git" | "new-project">("git")
  const [promptText, setPromptText] = createSignal("")
  const [formError, setFormError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  let promptRef: HTMLTextAreaElement | undefined

  const dialog = useDialog()
  const t = useT(useI18n())

  /** Navigate the browser URL without a full-page reload. */
  const navigate = (path: string) => window.history.pushState({}, "", path)

  /** Restore app phase from the current browser URL after sessions have loaded. */
  const restoreFromUrl = async () => {
    const m = window.location.pathname.match(/^\/session\/([a-f0-9]{12})$/)
    if (!m) return
    const hash = m[1]
    const session = sessions().find((s) => s.hash === hash)
    if (!session) return

    // Resume stopped sessions before setting app phase
    let wasResumed = false
    if (session.state === "stopped") {
      try {
        await resumeSession(session.hash)
        wasResumed = true
      } catch (error) {
        console.error("Failed to resume session from URL", error)
        setAppPhase({
          kind: "error",
          message: "Failed to resume session. Please try again or select a session from the list.",
        })
        return
      }
    }

    // After resuming, always use LoadingScreen. For running sessions with a
    // resolved URL go directly to open; otherwise LoadingScreen polls events SSE.
    const phaseKind = getPhaseKindAfterUrlRestore(wasResumed, session.url)
    if (phaseKind === "open" && session.url !== null) {
      setAppPhase({ kind: "open", hash, url: session.url })
    } else {
      setAppPhase({ kind: "creating", hash })
    }
  }

  onMount(() => {
    // SSE stream provides the initial snapshot and all subsequent updates.
    // loadSessions() is no longer called on mount — the SSE replaces polling.
    let es: EventSource | null = null
    const startStream = () => {
      es?.close()
      es = subscribeSessionsStream({
        onSessions: (data) => {
          batch(() => {
            setEmail(data.email)
            setSessions(data.sessions)
            if (appPhase().kind === "loading") {
              setAppPhase({ kind: "ready" })
              restoreFromUrl()
            }
          })
        },
        onError: () => {
          if (appPhase().kind === "loading") {
            setAppPhase({ kind: "error", message: t("app.error.connect") })
          }
        },
      })
    }
    startStream()

    const onPopState = async () => {
      const m = window.location.pathname.match(/^\/session\/([a-f0-9]{12})$/)
      if (!m) {
        setAppPhase({ kind: "ready" })
        return
      }
      const hash = m[1]
      const session = sessions().find((s) => s.hash === hash)
      if (!session) return

      // Resume stopped sessions
      let wasResumed = false
      if (session.state === "stopped") {
        try {
          await resumeSession(session.hash)
          wasResumed = true
        } catch (error) {
          console.error("Failed to resume session on popstate", error)
          setAppPhase({
            kind: "error",
            message: "Failed to resume session. Please try again or select a session from the list.",
          })
          return
        }
      }

      const phaseKind = getPhaseKindAfterUrlRestore(wasResumed, session.url)
      if (phaseKind === "open" && session.url !== null) {
        setAppPhase({ kind: "open", hash, url: session.url })
      } else {
        setAppPhase({ kind: "creating", hash })
      }
    }
    window.addEventListener("popstate", onPopState)
    onCleanup(() => {
      es?.close()
      window.removeEventListener("popstate", onPopState)
    })
  })

  const handleRepoUrlChange = async (url: string) => {
    setRepoUrl(url)
    if (!GIT_URL_PATTERN.test(url.trim())) return
    try {
      const { branch } = await suggestBranch(url.trim())
      setSessionBranch(branch)
    } catch {
      /* silent */
    }
  }

  const handleTerminateSession = (session: Session) => {
    const hash = session.hash
    const repo = session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
    dialog.show(() => (
      <Dialog fit title={t("session.terminate.title")} description={t("session.terminate.description", { repo })}>
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
              // If the terminated session was open, go back to ready
              const p = appPhase()
              if (p.kind === "open" && p.hash === hash) {
                navigate("/")
                setAppPhase({ kind: "ready" })
              }
              // SSE stream will update session list automatically via sessionsChangedBroadcaster
            }}
          >
            {t("session.action.terminate")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const handleSubmit = async () => {
    setFormError("")
    if (!promptText().trim()) return

    if (activeTab() === "new-project") {
      setSubmitting(true)
      try {
        const result = await createNewProjectSession(promptText())
        batch(() => {
          navigate(`/session/${result.hash}`)
          setAppPhase({ kind: "creating", hash: result.hash })
        })
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Network error")
      } finally {
        setSubmitting(false)
      }
      return
    }

    const validated = buildSessionKey(repoUrl(), sourceBranch(), {
      repoUrlRequired: t("form.error.repoUrl.required"),
      repoUrlInvalid: t("form.error.repoUrl.invalid"),
      sourceBranchRequired: t("form.error.sourceBranch.required"),
    })
    if (!validated.valid) {
      setFormError(validated.error)
      return
    }
    if (!sessionBranch()) {
      setFormError(t("form.error.sessionBranch"))
      return
    }
    setSubmitting(true)
    try {
      const result = await createSession(validated.repoUrl, sessionBranch(), validated.sourceBranch, promptText())
      batch(() => {
        navigate(`/session/${result.hash}`)
        setAppPhase({ kind: "creating", hash: result.hash })
      })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenSession = (session: Session) => {
    navigate(`/session/${session.hash}`)
    if (session.url !== null) {
      setAppPhase({ kind: "open", hash: session.hash, url: session.url })
    } else {
      // URL not yet resolved — LoadingScreen polls the events SSE until the deep link arrives
      setAppPhase({ kind: "creating", hash: session.hash })
    }
  }

  const handleResumeSession = async (session: Session) => {
    await resumeSession(session.hash)
    navigate(`/session/${session.hash}`)
    setAppPhase({ kind: "creating", hash: session.hash })
  }

  const activeHash = () => {
    const p = appPhase()
    return p.kind === "open" ? p.hash : p.kind === "creating" ? p.hash : undefined
  }

  const goHome = () => {
    navigate("/")
    setAppPhase({ kind: "ready" })
    setActiveTab("git")
    setTimeout(() => promptRef?.focus(), 50)
  }

  return (
    <div class="flex h-dvh overflow-hidden" style={{ background: "var(--background-base)" }}>
      {/* Sidebar: only on desktop, only when session is open/creating */}
      <div class="hidden md:contents">
        <Show when={appPhase().kind === "open" || appPhase().kind === "creating"}>
          <SessionSidebar
            collapsed={sidebarCollapsed()}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            sessions={sessions()}
            email={email()}
            activeHash={activeHash()}
            onNewSession={goHome}
            onOpenSession={handleOpenSession}
            onResumeSession={handleResumeSession}
            onTerminateSession={handleTerminateSession}
          />
        </Show>
      </div>

      <main class="flex flex-col flex-1 overflow-hidden">
        <Switch>
          <Match when={appPhase().kind === "loading"}>
            <div class="flex flex-1 items-center justify-center">
              <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                {t("app.loading")}
              </p>
            </div>
          </Match>

          <Match when={appPhase().kind === "ready"}>
            <div class="flex flex-1 flex-col items-center overflow-y-auto px-4 pt-12 pb-8 gap-6">
              <div class="w-full max-w-2xl flex flex-col gap-6">
                {/* Welcome heading */}
                <h1 class="text-18-medium text-center" style={{ color: "var(--text-base)" }}>
                  {t("app.welcomeBack", { email: email() || "—" })}
                </h1>

                {/* New session form */}
                <SessionInputBar
                  activeTab={activeTab()}
                  onTabChange={setActiveTab}
                  repoUrl={repoUrl()}
                  onRepoUrlChange={handleRepoUrlChange}
                  sourceBranch={sourceBranch()}
                  onSourceBranchChange={setSourceBranch}
                  sessionBranch={sessionBranch()}
                  promptText={promptText()}
                  onPromptTextChange={setPromptText}
                  formError={formError()}
                  submitting={submitting()}
                  onSubmit={handleSubmit}
                  ref={(el) => {
                    promptRef = el
                  }}
                />

                {/* Session list: always visible on all screen sizes */}
                <SessionList
                  sessions={sessions()}
                  terminating={terminating()}
                  onOpenSession={handleOpenSession}
                  onResumeSession={handleResumeSession}
                  onTerminateSession={handleTerminateSession}
                />
              </div>
            </div>
          </Match>

          <Match when={appPhase().kind === "creating" && (appPhase() as Extract<AppPhase, { kind: "creating" }>)}>
            {(p) => (
              <div class="flex flex-1 items-center justify-center">
                <LoadingScreen
                  hash={p().hash}
                  onReady={(url) => {
                    setAppPhase({ kind: "open", hash: p().hash, url })
                  }}
                  onError={(message) => {
                    setAppPhase({ kind: "error", message })
                  }}
                />
              </div>
            )}
          </Match>

          <Match when={appPhase().kind === "open" && (appPhase() as Extract<AppPhase, { kind: "open" }>)}>
            {(p) => (
              <iframe
                src={p().url}
                class="flex-1 w-full border-0"
                style={{ height: "100%" }}
                title="opencode session"
              />
            )}
          </Match>

          <Match when={appPhase().kind === "error" && (appPhase() as Extract<AppPhase, { kind: "error" }>)}>
            {(p) => (
              <div class="flex flex-1 items-center justify-center p-6">
                <p class="text-14-medium" style={{ color: "var(--text-danger-base, #ef4444)" }}>
                  {p().message}
                </p>
              </div>
            )}
          </Match>
        </Switch>
      </main>
    </div>
  )
}
