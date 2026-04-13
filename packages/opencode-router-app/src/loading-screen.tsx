import { onCleanup, onMount } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { getSessionState } from "./api"
import { useT } from "./i18n"

export function LoadingScreen(props: { hash: string; url: string }) {
  const t = useT(useI18n())
  let timer: ReturnType<typeof setInterval>

  onMount(() => {
    timer = setInterval(async () => {
      try {
        const session = await getSessionState(props.hash)
        if (session.state === "running") {
          clearInterval(timer)
          window.location.replace(props.url)
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
