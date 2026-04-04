import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "esnext",
  },
  server: {
    proxy: {
      // Forward all API calls and websocket connections to the router.
      // When the pod is running, the router proxies everything (including WS) to the opencode pod.
      // When no pod exists, the router serves the static SPA — but in dev we serve the SPA via Vite,
      // so only /api/* and websocket upgrades need to reach the router.
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
