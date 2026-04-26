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
  background: "var(--background-surface)",
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

  return (
    <div class="border-t p-4" style={{ "border-color": "var(--border-base)", background: "var(--background-base)" }}>
      <form
        class="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit()
        }}
      >
        <div class="flex gap-2">
          <input
            type="text"
            placeholder={t("app.newSession.repoUrl.placeholder")}
            value={props.repoUrl}
            onInput={(e) => props.onRepoUrlChange(e.currentTarget.value)}
            style={{ ...inputStyle, flex: "2" }}
          />
          <input
            type="text"
            placeholder={t("app.newSession.sourceBranch.placeholder")}
            value={props.sourceBranch}
            onInput={(e) => props.onSourceBranchChange(e.currentTarget.value)}
            style={{ ...inputStyle, flex: "1" }}
          />
          <Show when={props.sessionBranch}>
            <div
              class="flex items-center px-3 rounded"
              style={{
                background: "var(--background-highlight)",
                border: "1px solid var(--border-base)",
                color: "var(--text-dimmed-base)",
                "font-size": "12px",
                "white-space": "nowrap",
                "flex-shrink": "0",
              }}
            >
              {props.sessionBranch}
            </div>
          </Show>
        </div>

        <div class="flex gap-2 items-stretch">
          <textarea
            ref={props.ref}
            placeholder={t("app.newSession.prompt.placeholder")}
            value={props.promptText}
            onInput={(e) => props.onPromptTextChange(e.currentTarget.value)}
            required
            rows={2}
            style={{
              ...inputStyle,
              flex: "1",
              resize: "none",
              "font-family": "inherit",
            }}
          />
          <Button
            type="submit"
            icon="arrow-up"
            variant="primary"
            disabled={!canSubmit()}
            aria-label={canSubmit() ? t("form.submit") : (disabledReason(props, t) ?? t("form.submit"))}
            style={{ "align-self": "stretch", height: "auto" }}
          >
            {props.submitting ? t("form.submitting") : canSubmit() ? t("form.submit") : disabledReason(props, t)}
          </Button>
        </div>

        <Show when={props.formError}>
          <p class="text-12-regular" style={{ color: "var(--text-danger-base, #ef4444)" }}>
            {props.formError}
          </p>
        </Show>
      </form>
    </div>
  )
}
