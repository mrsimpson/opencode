import { onCleanup, onMount } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { getSessionState } from "./api"
import { useT } from "./i18n"

/** Max number of polls where state=running but no deep link before falling back to base URL. */
const MAX_RUNNING_WITHOUT_DEEPLINK = 10

export function LoadingScreen(props: { hash: string; url: string; onReady?: (url: string) => void }) {
  const t = useT(useI18n())
  let timer: ReturnType<typeof setInterval>
  let runningPolls = 0

  onMount(() => {
    timer = setInterval(async () => {
      try {
        const session = await getSessionState(props.hash)
        if (session.state !== "running") {
          runningPolls = 0
          return
        }
        const url = session.url || props.url
        // Prefer deep link (contains /session/). Fall back to base URL after
        // MAX_RUNNING_WITHOUT_DEEPLINK polls to handle sessions without initialMessage.
        const isDeepLink = url.includes("/session/")
        if (isDeepLink || ++runningPolls >= MAX_RUNNING_WITHOUT_DEEPLINK) {
          clearInterval(timer)
          if (props.onReady) props.onReady(url)
          else window.location.replace(url)
        }
      } catch {
        // Retry on next tick
      }
    }, 3000)
  })

  onCleanup(() => clearInterval(timer))

  return (
    <div class="flex flex-col items-center gap-4">
      <div
        class="size-6 rounded-full animate-spin"
        style={{
          border: "2px solid var(--border-base)",
          "border-top-color": "var(--icon-strong-base)",
        }}
      />
      <p class="text-14-medium" style={{ color: "var(--text-base)" }}>
        {t("loading.title")}
      </p>
      <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
        {t("loading.subtitle")}
      </p>
    </div>
  )
}
