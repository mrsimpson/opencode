import { onCleanup, onMount } from "solid-js"
import { getStatus } from "./api"

export function LoadingScreen() {
  let timer: ReturnType<typeof setInterval>

  onMount(() => {
    timer = setInterval(async () => {
      try {
        const status = await getStatus()
        if (status.state === "running") {
          clearInterval(timer)
          window.location.replace("/")
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
        Starting your OpenCode session...
      </p>
      <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
        This usually takes a few seconds.
      </p>
    </div>
  )
}
