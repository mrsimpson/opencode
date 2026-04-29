import { For, createMemo } from "solid-js"
import type { ModelProvider } from "./api"

type Props = {
  value: string
  onChange: (value: string) => void
  providers: ModelProvider[]
  loading: boolean
  disabled?: boolean
}

const selectStyle = {
  background: "var(--background-base)",
  border: "1px solid var(--border-base)",
  color: "var(--text-base)",
  "border-radius": "6px",
  padding: "8px 10px",
  "font-size": "13px",
  outline: "none",
  width: "100%",
  cursor: "pointer",
}

export function ModelSelect(props: Props) {
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

  // Find selected model info for display
  const selectedLabel = createMemo(() => {
    const pid = selectedProviderId()
    const mid = selectedModelId()
    if (!pid || !mid) return ""
    const provider = props.providers.find((p) => p.id === pid)
    if (!provider) return ""
    const model = provider.models.find((m) => m.id === mid)
    if (!model) return ""
    return `${provider.name || provider.id} - ${model.name || model.id}`
  })

  const handleChange = (e: Event) => {
    const target = e.target as HTMLSelectElement
    props.onChange(target.value)
  }

  return (
    <div class="flex gap-2 items-center">
      <select
        value={props.value}
        onChange={handleChange}
        disabled={props.disabled || props.loading}
        style={selectStyle}
      >
        <option value="">No specific model</option>
        <For each={props.providers}>
          {(provider) => (
            <optgroup label={provider.name || provider.id}>
              <For each={provider.models}>
                {(model) => <option value={`${provider.id}/${model.id}`}>{model.name || model.id}</option>}
              </For>
            </optgroup>
          )}
        </For>
      </select>

      {/* Selected model display */}
      {props.value && <div style={{ "font-size": "12px", color: "var(--text-dimmed-base)" }}>{selectedLabel()}</div>}

      {/* Loading indicator */}
      {props.loading && <div style={{ "font-size": "12px", color: "var(--text-dimmed-base)" }}>Loading...</div>}
    </div>
  )
}
