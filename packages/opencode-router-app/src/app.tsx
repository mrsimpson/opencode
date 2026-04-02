import { createSignal, Match, onMount, Switch } from "solid-js"
import { Logo } from "@opencode-ai/ui/logo"
import { getStatus } from "./api"
import { SetupForm } from "./setup-form"
import { LoadingScreen } from "./loading-screen"

type Phase = "loading" | "setup" | "creating" | "error"

export function App() {
  const [phase, setPhase] = createSignal<Phase>("loading")
  const [email, setEmail] = createSignal("")
  const [error, setError] = createSignal("")

  onMount(async () => {
    try {
      const status = await getStatus()
      setEmail(status.email)
      if (status.state === "running") {
        window.location.replace("/")
        return
      }
      setPhase(status.state === "none" ? "setup" : "creating")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect")
      setPhase("error")
    }
  })

  return (
    <div
      class="flex items-center justify-center min-h-dvh p-6"
      style={{ background: "var(--background-base)" }}
    >
      <div class="flex flex-col items-center gap-8 w-full" style={{ "max-width": "24rem" }}>
        <Logo class="h-7" />

        <Switch>
          <Match when={phase() === "loading"}>
            <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
              Loading...
            </p>
          </Match>

          <Match when={phase() === "setup"}>
            <SetupForm email={email()} onCreated={() => setPhase("creating")} />
          </Match>

          <Match when={phase() === "creating"}>
            <LoadingScreen />
          </Match>

          <Match when={phase() === "error"}>
            <p class="text-14-medium" style={{ color: "var(--text-danger-base, #ef4444)" }}>
              {error()}
            </p>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
