import type { Plugin } from "@opencode-ai/plugin"

const RouterPlugin: Plugin = async (_input) => {
  return {}
}

export default { id: "opencode-router", server: RouterPlugin }
