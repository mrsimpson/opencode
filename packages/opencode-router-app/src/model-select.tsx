import { createSignal, createMemo, For, Show } from "solid-js"
import type { ModelProvider } from "./api"

type Props = {
  value: string
  onChange: (value: string) => void
  providers: ModelProvider[]
  loading: boolean
  disabled?: boolean
}

export function ModelSelect(props: Props) {
  const [isOpen, setIsOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")

  // Parse current selection
  const selectedProviderId = createMemo(() => {
    const v = props.value
    if (!v) return ""
    const idx = v.indexOf("/")
    return idx > 0 ? v.slice(0, idx) : ""
  })

  const selectedModelId = createMemo(() => {
    const v = props.value
    if (!v) return ""
    const idx = v.indexOf("/")
    return idx > 0 ? v.slice(idx + 1) : ""
  })

  // Find selected model info
  const selectedInfo = createMemo(() => {
    const pid = selectedProviderId()
    const mid = selectedModelId()
    if (!pid || !mid) return null
    const provider = props.providers.find((p) => p.id === pid)
    if (!provider) return null
    const model = provider.models.find((m) => m.id === mid)
    if (!model) return null
    return {
      providerName: provider.name || provider.id,
      modelName: model.name || model.id,
    }
  })

  // Filter providers/models based on search
  const filteredProviders = createMemo(() => {
    const q = search().toLowerCase().trim()
    return props.providers
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((m) => {
          if (!q) return true
          const name = (m.name || m.id).toLowerCase()
          const providerName = (provider.name || provider.id).toLowerCase()
          return name.includes(q) || providerName.includes(q)
        }),
      }))
      .filter((p) => p.models.length > 0)
  })

  const handleSelect = (providerId: string, modelId: string) => {
    props.onChange(`${providerId}/${modelId}`)
    setIsOpen(false)
    setSearch("")
  }

  return (
    <div class="relative">
      {/* Model display button */}
      <button
        type="button"
        onClick={() => !props.disabled && !props.loading && setIsOpen(!isOpen())}
        disabled={props.disabled || props.loading}
        class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors"
        style={{
          background: "var(--background-base)",
          border: "1px solid var(--border-base)",
          color: props.value ? "var(--text-base)" : "var(--text-muted)",
          cursor: props.disabled || props.loading ? "not-allowed" : "pointer",
        }}
      >
        {props.loading ? (
          <span class="text-xs">Loading models...</span>
        ) : props.value && selectedInfo() ? (
          <>
            <span>{selectedInfo()!.providerName}</span>
            <span style={{ color: "var(--text-muted)" }}>·</span>
            <span class="font-medium">{selectedInfo()!.modelName}</span>
          </>
        ) : (
          <span>No specific model</span>
        )}
        <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Modal overlay */}
      <Show when={isOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setIsOpen(false)}
        >
          <div
            class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[70vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search header */}
            <div class="p-4 border-b" style={{ "border-color": "var(--border-base)" }}>
              <input
                type="text"
                placeholder="Search models..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="w-full px-4 py-2 rounded-lg border text-sm"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  outline: "none",
                }}
                autofocus
              />
            </div>

            {/* Model list */}
            <div class="overflow-y-auto" style={{ "max-height": "calc(70vh - 120px)" }}>
              <For each={filteredProviders()}>
                {(provider) => (
                  <div class="border-b last:border-b-0" style={{ "border-color": "var(--border-base)" }}>
                    <div
                      class="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--text-muted)", background: "var(--background-surface)" }}
                    >
                      {provider.name || provider.id}
                    </div>
                    <For each={provider.models}>
                      {(model) => (
                        <button
                          type="button"
                          class="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between"
                          style={{
                            background:
                              selectedProviderId() === provider.id && selectedModelId() === model.id
                                ? "var(--background-surface)"
                                : "transparent",
                          }}
                          onClick={() => handleSelect(provider.id, model.id)}
                        >
                          <span class="text-sm">{model.name || model.id}</span>
                          {selectedProviderId() === provider.id && selectedModelId() === model.id && (
                            <svg class="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fill-rule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
              <Show when={filteredProviders().length === 0 && !props.loading}>
                <div class="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  No models found
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div
              class="p-3 border-t text-xs"
              style={{ "border-color": "var(--border-base)", color: "var(--text-muted)" }}
            >
              {props.value ? (
                <button
                  type="button"
                  class="text-red-500 hover:underline"
                  onClick={() => {
                    props.onChange("")
                    setIsOpen(false)
                  }}
                >
                  Clear selection
                </button>
              ) : (
                <span>No model selected - opencode default will be used</span>
              )}
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
