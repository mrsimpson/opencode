import { Button } from "@opencode-ai/ui/button";
import { Logo } from "@opencode-ai/ui/logo";
import { For, Match, Show, Switch, createSignal, onMount } from "solid-js";
import { type Session, listSessions } from "./api";
import { LoadingScreen } from "./loading-screen";
import { SetupForm } from "./setup-form";

type Phase =
  | { kind: "loading" }
  | { kind: "list"; sessions: Session[]; email: string }
  | { kind: "new-session"; email: string }
  | { kind: "creating"; hash: string; url: string }
  | { kind: "error"; message: string };

export function App() {
  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" });

  const loadSessions = async () => {
    try {
      const sessions = await listSessions();
      const email = sessions[0]?.email ?? "";
      setPhase({ kind: "list", sessions, email });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to connect",
      });
    }
  };

  onMount(loadSessions);

  return (
    <div
      class="flex items-center justify-center min-h-dvh p-6"
      style={{ background: "var(--background-base)" }}
    >
      <div class="flex flex-col items-center gap-8 w-full" style={{ "max-width": "28rem" }}>
        <Logo class="h-7" />

        <Switch>
          <Match when={phase().kind === "loading"}>
            <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
              Loading...
            </p>
          </Match>

          <Match when={phase().kind === "list" && (phase() as Extract<Phase, { kind: "list" }>)}>
            {(p) => (
              <div class="flex flex-col gap-6 w-full">
                <div class="flex flex-col gap-1">
                  <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                    Signed in as {p().email || "—"}
                  </p>
                </div>

                <Show when={p().sessions.length > 0}>
                  <div class="flex flex-col gap-2">
                    <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                      Your sessions
                    </p>
                    <For each={p().sessions}>
                      {(session) => (
                        <a
                          href={session.url}
                          class="flex flex-col gap-1 p-3 rounded-lg border"
                          style={{
                            background: "var(--background-surface)",
                            "border-color": "var(--border-base)",
                            "text-decoration": "none",
                          }}
                        >
                          <p class="text-13-medium" style={{ color: "var(--text-base)" }}>
                            {session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")}
                          </p>
                          <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                            {session.branch} · {session.state}
                          </p>
                        </a>
                      )}
                    </For>
                  </div>
                </Show>

                <Button
                  variant="primary"
                  size="large"
                  onClick={() => setPhase({ kind: "new-session", email: p().email })}
                >
                  New Session
                </Button>
              </div>
            )}
          </Match>

          <Match
            when={
              phase().kind === "new-session" && (phase() as Extract<Phase, { kind: "new-session" }>)
            }
          >
            {(p) => (
              <div class="flex flex-col gap-4 w-full">
                <button
                  onClick={loadSessions}
                  class="text-12-regular self-start"
                  style={{
                    color: "var(--text-dimmed-base)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ← Back
                </button>
                <SetupForm
                  email={p().email}
                  onCreated={(hash, url) => setPhase({ kind: "creating", hash, url })}
                />
              </div>
            )}
          </Match>

          <Match
            when={phase().kind === "creating" && (phase() as Extract<Phase, { kind: "creating" }>)}
          >
            {(p) => <LoadingScreen hash={p().hash} url={p().url} />}
          </Match>

          <Match when={phase().kind === "error" && (phase() as Extract<Phase, { kind: "error" }>)}>
            {(p) => (
              <p class="text-14-medium" style={{ color: "var(--text-danger-base, #ef4444)" }}>
                {p().message}
              </p>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
