import { test, expect, type Page } from "@playwright/test"

/**
 * End-to-end tests for the opencode-router session lifecycle:
 *   1. Sessions list — shows existing sessions with correct state badges
 *   2. New session — input bar always visible; fill repo URL, source branch, prompt → send
 *   3. Create session (git) — submits, shows loading screen, auto-redirects to session URL
 *   4. Create session (new project / no repoUrl) — tab switch, prompt only, loading screen,
 *      auto-redirects to session URL — verifies the PVC/pod hash mismatch fix
 *   5. Resume session — stopped session can be resumed via options menu → creating → running
 *   6. Terminate session — session disappears from list after termination via options menu
 *
 * Requires:
 *   - opencode-router running at http://localhost:3002 with DEV_EMAIL=dev@local.test
 *   - opencode-router-app Vite dev server at http://localhost:5173 (proxied by router)
 *   - kubectl access to the "code" namespace
 */

const REPO_URL = "https://github.com/mrsimpson/port-a-dice"
const SOURCE_BRANCH = "main"
const PROMPT_TEXT = "Fix the README"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goHome(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome back,")
}

async function fillNewSessionForm(page: Page) {
  // Input bar is always visible — fill repo URL
  await page.getByPlaceholder("https://github.com/org/repo.git").fill(REPO_URL)
  // Fill source branch
  await page.getByPlaceholder("main").fill(SOURCE_BRANCH)
  // Wait for session branch to be suggested (non-empty)
  await expect(page.getByTestId("session-branch-display")).not.toBeEmpty()
  // Fill prompt
  await page.getByRole("textbox", { name: /prompt|task|question/i }).fill(PROMPT_TEXT)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("sessions list", () => {
  test("shows welcome heading and session list on load", async ({ page }) => {
    await goHome(page)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome back,")
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Sessions")
  })

  test("shows always-visible input bar at bottom of main", async ({ page }) => {
    await goHome(page)
    await expect(page.getByPlaceholder("https://github.com/org/repo.git")).toBeVisible()
    await expect(page.getByPlaceholder("main")).toBeVisible()
    await expect(page.getByRole("button", { name: /send|start/i })).toBeVisible()
  })
})

test.describe("new session form", () => {
  test("input bar shows repo URL, source branch, and send button", async ({ page }) => {
    await goHome(page)
    await expect(page.getByPlaceholder("https://github.com/org/repo.git")).toBeVisible()
    await expect(page.getByPlaceholder("main")).toBeVisible()
    await expect(page.getByRole("button", { name: /send|start/i })).toBeVisible()
  })

  test("suggests session branch after repo URL entry", async ({ page }) => {
    await goHome(page)

    await page.getByPlaceholder("https://github.com/org/repo.git").fill(REPO_URL)
    await page.keyboard.press("Tab") // trigger blur → suggestBranch call

    // Wait for the suggested session branch to appear in the display element
    await expect(page.getByTestId("session-branch-display")).not.toBeEmpty()
  })

  test("source-branch and repo-url inputs disable mobile auto-capitalization", async ({ page }) => {
    // Mobile keyboards auto-capitalize the first letter by default. Entering a
    // branch "main" then becomes "Main" and the pod's init container crashloops
    // on `git checkout origin/Main`. Verify the fields opt out.
    await goHome(page)

    const repo = page.getByPlaceholder("https://github.com/org/repo.git")
    const source = page.getByPlaceholder("main")

    await expect(repo).toHaveAttribute("autocapitalize", "none")
    await expect(repo).toHaveAttribute("autocorrect", "off")
    await expect(repo).toHaveAttribute("spellcheck", "false")

    await expect(source).toHaveAttribute("autocapitalize", "none")
    await expect(source).toHaveAttribute("autocorrect", "off")
    await expect(source).toHaveAttribute("spellcheck", "false")
  })
})

test.describe("create session", () => {
  test("creates session, shows loading screen, auto-redirects to session URL", async ({ page }) => {
    await goHome(page)
    await fillNewSessionForm(page)
    await page.getByRole("button", { name: /send|start/i }).click()

    // Loading screen
    await expect(page.getByText("Starting your OpenCode session...")).toBeVisible()
    await expect(page.getByText("This usually takes a few seconds.")).toBeVisible()

    // Wait for auto-redirect to session subdomain (pod starts up + git-init)
    await page.waitForURL(/\.localhost:3002\/$/, { timeout: 90_000 })

    // Verify we're on the opencode app (not the router SPA)
    const url = page.url()
    expect(url).toMatch(/^http:\/\/[a-f0-9]{12}\.localhost:3002\/$/)
  })
})

// ---------------------------------------------------------------------------
// New project (no repoUrl) — blank-disc session creation
// Regression test for: PVC/pod hash mismatch when getSessionHash() uses
// crypto.randomUUID() and is called independently for ensurePVC and ensurePod.
// ---------------------------------------------------------------------------

test.describe("create session — new project (no repoUrl)", () => {
  test("switches to New Project tab, shows prompt-only form", async ({ page }) => {
    await goHome(page)

    // Switch to the New Project tab
    await page.getByRole("button", { name: "New Project" }).click()

    // Repo URL and source branch inputs should NOT be visible
    await expect(page.getByPlaceholder("https://github.com/org/repo.git")).not.toBeVisible()
    await expect(page.getByPlaceholder("main")).not.toBeVisible()

    // Prompt textarea should be visible and submit disabled (prompt empty)
    await expect(page.getByPlaceholder("Describe a task or ask a question")).toBeVisible()
    await expect(page.getByRole("button", { name: /start session/i })).toBeDisabled()
  })

  test("send button enables once prompt is filled", async ({ page }) => {
    await goHome(page)
    await page.getByRole("button", { name: "New Project" }).click()

    await page.getByPlaceholder("Describe a task or ask a question").fill("Build me a new app")

    await expect(page.getByRole("button", { name: /start session/i })).toBeEnabled()
  })

  test(
    "creates new-project session, shows loading screen, redirects to session URL",
    async ({ page }) => {
      await goHome(page)

      // Switch to New Project tab
      await page.getByRole("button", { name: "New Project" }).click()

      // Fill prompt only — no repoUrl, no sourceBranch
      await page.getByPlaceholder("Describe a task or ask a question").fill("Build me a new app")

      // Submit
      await page.getByRole("button", { name: /start session/i }).click()

      // Loading screen must appear — confirms the frontend got a hash back from the router
      await expect(page.getByText("Starting your OpenCode session...")).toBeVisible({ timeout: 10_000 })

      // Wait for the pod to start and auto-redirect to the session subdomain.
      // This is the key assertion: if PVC and pod used different hashes the pod
      // would crashloop and the redirect would never happen.
      await page.waitForURL(/\.localhost:3002\/$/, { timeout: 120_000 })

      // Confirm we landed on a valid session subdomain URL
      expect(page.url()).toMatch(/^http:\/\/[a-f0-9]{12}\.localhost:3002\/$/)
    },
  )
})

test.describe("resume session", () => {
  test("resumes a stopped session and shows it as creating", async ({ page }) => {
    await goHome(page)

    // Find a stopped session row
    const stoppedRow = page.locator("text=stopped").first()
    const hasStoppedSession = (await stoppedRow.count()) > 0

    if (!hasStoppedSession) {
      test.skip()
      return
    }

    // Hover the first stopped session row to reveal the options button
    const sessionRow = stoppedRow.locator("xpath=ancestor::*[self::li or self::tr or self::div][1]")
    await sessionRow.hover()

    // Open the 3-dot options menu
    await sessionRow.getByRole("button", { name: /options|more|⋮/i }).click()

    // Click "Resume" in the menu
    await page.getByRole("menuitem", { name: /resume/i }).click()

    // After resume, the session should transition to creating (and become a link)
    await expect(page.getByText("creating")).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("terminate session", () => {
  test("removes session from list after termination", async ({ page }) => {
    await goHome(page)

    // Count session rows before termination
    const sessionRows = page.locator("[data-session-row], li[class*='session'], div[class*='session-item']")
    const before = await sessionRows.count()
    if (before === 0) {
      test.skip()
      return
    }

    // Note the branch/title of the first session before terminating
    const firstRow = sessionRows.first()
    const rowText = await firstRow.textContent()

    // Hover to reveal options button
    await firstRow.hover()
    await firstRow.getByRole("button", { name: /options|more|⋮/i }).click()

    // Click "Terminate" in the dropdown menu
    await page.getByRole("menuitem", { name: /terminate/i }).click()

    // Session count should decrease by one
    const after = await sessionRows.count()
    expect(after).toBe(before - 1)

    // The specific session text should no longer appear
    if (rowText) {
      const identifier = rowText.split(" · ")[0].trim()
      if (identifier) {
        await expect(page.getByText(identifier, { exact: true })).not.toBeVisible()
      }
    }
  })
})
