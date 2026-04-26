import { Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { Button } from "@opencode-ai/ui/button"
import { useT } from "./i18n"
import { GIT_URL_PATTERN } from "./setup-form-utils"

type Props = {
  repoUrl: string
  onRepoUrlChange: (v: string) => void
  sourceBranch: string
  onSourceBranchChange: (v: string) => void
  sessionBranch: string
  promptText: string
  onPromptTextChange: (v: string) => void
  formError: string
  submitting: boolean
  onSubmit: () => void
  ref?: (el: HTMLTextAreaElement) => void
}

import type { DictKey } from "./i18n/en"

function disabledReason(props: Props, t: (key: DictKey) => string): string | null {
  if (!GIT_URL_PATTERN.test(props.repoUrl.trim())) return t("form.error.repoUrl.invalid")
  if (!props.sourceBranch.trim()) return t("form.error.sourceBranch.required")
  if (!props.sessionBranch.trim()) return t("form.error.sessionBranch.waiting")
  if (!props.promptText.trim()) return t("form.error.prompt.required")
  return null
}

const inputStyle = {
  background: "var(--background-base)",
  border: "1px solid var(--border-base)",
  color: "var(--text-base)",
  "border-radius": "6px",
  padding: "8px 10px",
  "font-size": "13px",
  outline: "none",
  width: "100%",
}

export function SessionInputBar(props: Props) {
  const t = useT(useI18n())
  const canSubmit = () =>
    GIT_URL_PATTERN.test(props.repoUrl.trim()) &&
    props.sourceBranch.trim().length > 0 &&
    props.sessionBranch.trim().length > 0 &&
    props.promptText.trim().length > 0 &&
    !props.submitting

  const errorMessage = () => props.formError || disabledReason(props, t)

  return (
    <div
      class="rounded-xl border p-4"
      style={{ background: "var(--background-surface)", "border-color": "var(--border-base)" }}
    >
      <form
        class="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit()
        }}
      >
        <div class="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder={t("app.newSession.repoUrl.placeholder")}
            value={props.repoUrl}
            onInput={(e) => props.onRepoUrlChange(e.currentTarget.value)}
            style={{ ...inputStyle, flex: "2 1 180px" }}
          />
          <input
            type="text"
            placeholder={t("app.newSession.sourceBranch.placeholder")}
            value={props.sourceBranch}
            onInput={(e) => props.onSourceBranchChange(e.currentTarget.value)}
            style={{ ...inputStyle, flex: "1 1 100px" }}
          />
        </div>

        <textarea
          ref={props.ref}
          autofocus
          placeholder={t("app.newSession.prompt.placeholder")}
          value={props.promptText}
          onInput={(e) => props.onPromptTextChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              props.onSubmit()
            }
          }}
          required
          rows={3}
          style={{
            ...inputStyle,
            resize: "none",
            "font-family": "inherit",
          }}
        />

        <div class="flex items-center" style={{ "min-height": "32px" }}>
          <Show
            when={errorMessage()}
            fallback={
              <Button type="submit" icon="arrow-up" variant="primary" disabled={!canSubmit()} class="w-full">
                {props.submitting ? t("form.submitting") : t("form.submit")}
              </Button>
            }
          >
            {(msg) => (
              <p
                style={{
                  color: "var(--text-on-critical-base)",
                  "font-family": "var(--font-family-sans)",
                  "font-size": "var(--font-size-small)",
                  "font-weight": "var(--font-weight-medium)",
                  "line-height": "18px",
                }}
              >
                {msg()}
              </p>
            )}
          </Show>
        </div>
      </form>
    </div>
  )
}
