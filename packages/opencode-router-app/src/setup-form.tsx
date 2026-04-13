import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useI18n } from "@opencode-ai/ui/context"
import { Show, createSignal, onMount } from "solid-js"
import { createSession, suggestBranch } from "./api"
import { useT } from "./i18n"
import { buildSessionKey } from "./setup-form-utils"

export { buildSessionKey }

const GIT_URL_PATTERN = /^https?:\/\/.+\/.+/

export function SetupForm(props: { email: string; onCreated: (hash: string, url: string) => void }) {
  const t = useT(useI18n())
  const [repoUrl, setRepoUrl] = createSignal("")
  const [sourceBranch, setSourceBranch] = createSignal("")
  const [sessionBranch, setSessionBranch] = createSignal("")
  const [error, setError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  // Fetch a suggested session branch name on mount
  onMount(async () => {
    try {
      const { branch } = await suggestBranch("")
      setSessionBranch(branch)
    } catch {
      // silent — will retry when URL is entered
    }
  })

  const refreshSessionBranch = async (url: string) => {
    if (!GIT_URL_PATTERN.test(url.trim())) return
    try {
      const { branch } = await suggestBranch(url.trim())
      setSessionBranch(branch)
    } catch {
      // silent
    }
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault()
    const validated = buildSessionKey(repoUrl(), sourceBranch(), {
      repoUrlRequired: t("form.error.repoUrl.required"),
      repoUrlInvalid: t("form.error.repoUrl.invalid"),
      sourceBranchRequired: t("form.error.sourceBranch.required"),
    })
    if (!validated.valid) {
      setError(validated.error)
      return
    }
    if (!sessionBranch()) {
      setError(t("form.error.sessionBranch"))
      return
    }
    setError("")
    setSubmitting(true)
    try {
      const result = await createSession(validated.repoUrl, sessionBranch(), validated.sourceBranch)
      props.onCreated(result.hash, result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-6 w-full">
      <div class="flex flex-col gap-1">
        <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
          Signed in as {props.email}
        </p>
      </div>

      <div
        onFocusOut={(e) =>
          refreshSessionBranch((e.currentTarget.querySelector("input") as HTMLInputElement)?.value ?? repoUrl())
        }
      >
        <TextField
          autofocus
          label={t("form.repoUrl.label")}
          placeholder={t("form.repoUrl.placeholder")}
          value={repoUrl()}
          onChange={setRepoUrl}
          validationState={error() ? "invalid" : undefined}
          error={error()}
        />
      </div>

      <TextField
        label={t("form.sourceBranch.label")}
        placeholder={t("form.sourceBranch.placeholder")}
        value={sourceBranch()}
        onChange={setSourceBranch}
      />

      <Show when={sessionBranch()}>
        <div class="flex flex-col gap-1">
          <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
            {t("form.sessionBranch.label")}
          </p>
          <p class="text-13-medium font-mono" style={{ color: "var(--text-base)" }}>
            {sessionBranch()}
          </p>
        </div>
      </Show>

      <Button type="submit" variant="primary" size="large" disabled={submitting()}>
        {submitting() ? t("form.submitting") : t("form.submit")}
      </Button>
    </form>
  )
}
