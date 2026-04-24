import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog, useI18n } from "@opencode-ai/ui/context"
import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { type Session, createSession, listSessions, resumeSession, suggestBranch, terminateSession } from "./api"
import { useT } from "./i18n"
import { LoadingScreen } from "./loading-screen"
import { SessionInputBar } from "./session-input-bar"
import { SessionList } from "./session-list"
import { SessionSidebar } from "./session-sidebar"
import { buildSessionKey } from "./setup-form-utils"

type AppPhase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "creating"; hash: string; url: string }
  | { kind: "error"; message: string }

const GIT_URL_PATTERN = /^https?:\/\/.+\/.+/

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [appPhase, setAppPhase] = createSignal<AppPhase>({ kind: "loading" })
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [email, setEmail] = createSignal("")
  const [terminating, setTerminating] = createSignal<Set<string>>(new Set())

  const [repoUrl, setRepoUrl] = createSignal("")
  const [sourceBranch, setSourceBranch] = createSignal("")
  const [sessionBranch, setSessionBranch] = createSignal("")
  const [promptText, setPromptText] = createSignal("")
  const [formError, setFormError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  let promptRef: HTMLTextAreaElement | undefined

  const dialog = useDialog()
  const t = useT(useI18n())

  const loadSessions = async () => {
    try {
      const data = await listSessions()
      setEmail(data.email)
      setSessions(data.sessions)
      setAppPhase({ kind: "ready" })
    } catch (err) {
      const message =
        err instanceof Error && err.name === "TimeoutError"
          ? t("app.error.timeout")
          : err instanceof Error
            ? err.message
            : t("app.error.connect")
      setAppPhase({ kind: "error", message })
    }
  }

  onMount(() => {
    loadSessions()
    const timer = setInterval(() => {
      const p = appPhase()
      if (p.kind === "ready" || p.kind === "loading") loadSessions()
    }, 5_000)
    onCleanup(() => clearInterval(timer))
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
              loadSessions()
            }}
          >
            {t("session.action.terminate")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const handleSubmit = async () => {
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
    if (!promptText().trim()) return
    setFormError("")
    setSubmitting(true)
    try {
      const result = await createSession(validated.repoUrl, sessionBranch(), validated.sourceBranch, promptText())
      setAppPhase({ kind: "creating", hash: result.hash, url: result.url })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenSession = (session: Session) => {
    // If the URL is already a deep link (contains /session/), navigate directly.
    // Otherwise show LoadingScreen so it can poll until the deep link is ready.
    if (session.url.includes("/session/")) {
      window.location.href = session.url
    } else {
      setAppPhase({ kind: "creating", hash: session.hash, url: session.url })
    }
  }

  return (
    <div class="flex h-dvh overflow-hidden" style={{ background: "var(--background-base)" }}>
      <Show when={appPhase().kind !== "loading"}>
        <SessionSidebar
          collapsed={sidebarCollapsed()}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          sessions={sessions()}
          email={email()}
          onNewSession={() => promptRef?.focus()}
          onOpenSession={(session) => {
            handleOpenSession(session)
          }}
          onResumeSession={async (session) => {
            await resumeSession(session.hash)
            setAppPhase({ kind: "creating", hash: session.hash, url: session.url })
          }}
          onTerminateSession={handleTerminateSession}
        />
      </Show>

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
            <div class="flex flex-col flex-1 overflow-y-auto p-6 gap-6">
              <h1 class="text-18-medium" style={{ color: "var(--text-base)" }}>
                {t("app.welcomeBack", { email: email() || "—" })}
              </h1>
              <SessionList
                sessions={sessions()}
                terminating={terminating()}
                onOpenSession={(session) => {
                  handleOpenSession(session)
                }}
                onResumeSession={async (session) => {
                  await resumeSession(session.hash)
                  setAppPhase({ kind: "creating", hash: session.hash, url: session.url })
                }}
                onTerminateSession={handleTerminateSession}
              />
            </div>
            <SessionInputBar
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
          </Match>

          <Match when={appPhase().kind === "creating" && (appPhase() as Extract<AppPhase, { kind: "creating" }>)}>
            {(p) => (
              <div class="flex flex-1 items-center justify-center">
                <LoadingScreen hash={p().hash} url={p().url} />
              </div>
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
