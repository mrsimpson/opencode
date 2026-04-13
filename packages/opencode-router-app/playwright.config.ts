import { defineConfig, devices } from "@playwright/test"

/**
 * E2E tests for opencode-router-app.
 *
 * Prerequisites (already running):
 *   - opencode-router:  bun dev  (packages/opencode-router)   → http://localhost:3002
 *   - opencode-router-app: bun dev (packages/opencode-router-app) → http://localhost:5173 (proxied via router)
 *
 * The tests target the router at http://localhost:3002.
 * DEV_EMAIL=dev@local.test is set in the router's .env.local so no real auth is needed.
 *
 * Run:
 *   cd packages/opencode-router-app && bunx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  use: {
    baseURL: process.env.ROUTER_URL ?? "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "msedge",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
  ],
})
