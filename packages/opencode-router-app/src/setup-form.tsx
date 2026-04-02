import { createSignal } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { createSession } from "./api"

const GIT_URL_PATTERN = /^https?:\/\/.+\/.+/

export function SetupForm(props: { email: string; onCreated: () => void }) {
  const [repoUrl, setRepoUrl] = createSignal("")
  const [error, setError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  const validate = (): string | null => {
    const url = repoUrl().trim()
    if (!url) return "Repository URL is required"
    if (!GIT_URL_PATTERN.test(url)) return "Enter a valid HTTP(S) repository URL"
    return null
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError("")
    setSubmitting(true)
    try {
      const result = await createSession(repoUrl().trim())
      if (!result.ok) {
        setError(result.error ?? "Failed to create session")
        return
      }
      props.onCreated()
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

      <TextField
        autofocus
        label="Git repository URL"
        placeholder="https://github.com/org/repo.git"
        value={repoUrl()}
        onChange={setRepoUrl}
        validationState={error() ? "invalid" : undefined}
        error={error()}
      />

      <Button type="submit" variant="primary" size="large" disabled={submitting()}>
        {submitting() ? "Starting..." : "Start Session"}
      </Button>
    </form>
  )
}
