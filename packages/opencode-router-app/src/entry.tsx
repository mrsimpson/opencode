import { render } from "solid-js/web"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { DialogProvider, I18nProvider } from "@opencode-ai/ui/context"
import { createI18n } from "./i18n"
import { App } from "./app"
import "./index.css"

const i18n = createI18n(navigator.language || "en")

render(
  () => (
    <ThemeProvider>
      <I18nProvider value={i18n}>
        <DialogProvider>
          <App />
        </DialogProvider>
      </I18nProvider>
    </ThemeProvider>
  ),
  document.getElementById("root")!,
)
