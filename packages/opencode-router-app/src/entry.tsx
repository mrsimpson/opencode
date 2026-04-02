import { render } from "solid-js/web"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { App } from "./app"
import "./index.css"

render(
  () => (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  ),
  document.getElementById("root")!,
)
