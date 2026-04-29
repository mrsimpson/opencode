import { For } from "solid-js"
import type { ModelProvider } from "./api"

type Props = {
  value: string
  onChange: (value: string) => void
  providers: ModelProvider[]
  loading: boolean
  disabled?: boolean
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

export function ModelSelect(props: Props) {
  const selectedProviderId = () => {
    const v = props.value
    if (!v) return ""
    const idx = v.indexOf("/")
    return idx > 0 ? v.slice(0, idx) : ""
  }

  const selectedModelId = () => {
    const v = props.value
    if (!v) return ""
    const idx = v.indexOf("/")
    return idx > 0 ? v.slice(idx + 1) : ""
  }

  const handleProviderChange = (e: Event) => {
    const target = e.target as HTMLSelectElement
    const newProviderId = target.value
    if (!newProviderId) {
      props.onChange("")
      return
    }
    // Keep model if same provider, otherwise clear
    const currentModelId = selectedModelId()
    if (currentModelId) {
      const provider = props.providers.find((p) => p.id === newProviderId)
      if (provider?.models.some((m) => m.id === currentModelId)) {
        props.onChange(`${newProviderId}/${currentModelId}`)
        return
      }
    }
    props.onChange("")
  }

  const handleModelChange = (e: Event) => {
    const target = e.target as HTMLSelectElement
    const modelId = target.value
    const providerId = selectedProviderId()
    if (!modelId || !providerId) {
      props.onChange("")
    } else {
      props.onChange(`${providerId}/${modelId}`)
    }
  }

  return (
    <div class="flex gap-2">
      {/* Provider selector */}
      <select
        value={selectedProviderId()}
        onChange={handleProviderChange}
        disabled={props.disabled || props.loading}
        style={{
          ...inputStyle,
          flex: "0 0 auto",
          "min-width": "150px",
        }}
      >
        <option value="">No specific model</option>
        <For each={props.providers}>
          {(provider) => <option value={provider.id}>{provider.name || provider.id}</option>}
        </For>
      </select>

      {/* Model selector */}
      <select
        value={selectedModelId()}
        onChange={handleModelChange}
        disabled={props.disabled || props.loading || !selectedProviderId()}
        style={{
          ...inputStyle,
          flex: "1",
        }}
      >
        <option value="">{selectedProviderId() ? "Select a model..." : "Select provider first"}</option>
        <For each={props.providers.find((p) => p.id === selectedProviderId())?.models ?? []}>
          {(model) => <option value={model.id}>{model.name || model.id}</option>}
        </For>
      </select>

      {/* Loading indicator */}
      {props.loading && (
        <div class="flex items-center" style={{ "font-size": "12px", color: "var(--text-dimmed-base)" }}>
          Loading...
        </div>
      )}
    </div>
  )
}
