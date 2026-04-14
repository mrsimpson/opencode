import { test, expect, type Page } from "@playwright/test"

/**
 * End-to-end tests for the opencode-router session lifecycle:
 *   1. Sessions list — shows existing sessions with correct state badges
 *   2. New session — form with repo URL, source branch, suggested session branch
 *   3. Create session — submits, shows loading screen, auto-redirects to session URL
 *   4. Resume session — stopped session can be resumed → transitions to creating → running
 *   5. Terminate session — session disappears from list after termination
 *
 * Requires:
 *   - opencode-router running at http://localhost:3002 with DEV_EMAIL=dev@local.test
 *   - opencode-router-app Vite dev server at http://localhost:5173 (proxied by router)
 *   - kubectl access to the "code" namespace
 */

const REPO_URL = "https://github.com/mrsimpson/port-a-dice"
const SOURCE_BRANCH = "main"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goHome(page: Page) {
  await page.goto("/")
  await expect(page.getByText("Signed in as")).toBeVisible()
}

async function openNewSessionForm(page: Page) {
  await page.getByRole("button", { name: "New Session" }).click()
  await expect(page.getByRole("textbox", { name: "Git repository URL" })).toBeVisible()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("sessions list", () => {
  test("shows email and session list on load", async ({ page }) => {
    await goHome(page)
    await expect(page.getByText("Signed in as dev@local.test")).toBeVisible()
    await expect(page.getByText("Your sessions")).toBeVisible()
  })

  test("shows New Session button", async ({ page }) => {
    await goHome(page)
    await expect(page.getByRole("button", { name: "New Session" })).toBeVisible()
  })
})

test.describe("new session form", () => {
  test("opens setup form on New Session click", async ({ page }) => {
    await goHome(page)
    await openNewSessionForm(page)
    await expect(page.getByRole("textbox", { name: "Git repository URL" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Source branch (start from)" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Start Session" })).toBeVisible()
  })

  test("Back button returns to sessions list", async ({ page }) => {
    await goHome(page)
    await openNewSessionForm(page)
    await page.getByRole("button", { name: "← Back" }).click()
    await expect(page.getByText("Your sessions")).toBeVisible()
  })

  test("suggests session branch after repo URL entry", async ({ page }) => {
    await goHome(page)
    await openNewSessionForm(page)

    await page.getByRole("textbox", { name: "Git repository URL" }).fill(REPO_URL)
    await page.keyboard.press("Tab") // trigger blur → suggestBranch call

    // Wait for the suggested branch label to appear
    await expect(page.getByText("Your session branch")).toBeVisible()
    const branch = page.locator("p", { hasText: /^[a-z]+-[a-z]+-[a-z]+$/ })
    await expect(branch).toBeVisible()
  })

  test("shows validation error when source branch is empty", async ({ page }) => {
    await goHome(page)
    await openNewSessionForm(page)

    await page.getByRole("textbox", { name: "Git repository URL" }).fill(REPO_URL)
    await page.keyboard.press("Tab")
    await expect(page.getByText("Your session branch")).toBeVisible()

    // Submit without filling source branch
    await page.getByRole("button", { name: "Start Session" }).click()
    await expect(page.getByText("Source branch is required")).toBeVisible()
  })

  test("source-branch and repo-url inputs disable mobile auto-capitalization", async ({ page }) => {
    // Mobile keyboards auto-capitalize the first letter by default. Entering a
    // branch "main" then becomes "Main" and the pod's init container crashloops
    // on `git checkout origin/Main`. Verify the fields opt out.
    await goHome(page)
    await openNewSessionForm(page)

    const repo = page.getByRole("textbox", { name: "Git repository URL" })
    const source = page.getByRole("textbox", { name: "Source branch (start from)" })

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
    await openNewSessionForm(page)

    await page.getByRole("textbox", { name: "Git repository URL" }).fill(REPO_URL)
    await page.keyboard.press("Tab")
    await expect(page.getByText("Your session branch")).toBeVisible()

    await page.getByRole("textbox", { name: "Source branch (start from)" }).fill(SOURCE_BRANCH)
    await page.getByRole("button", { name: "Start Session" }).click()

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

test.describe("resume session", () => {
  test("resumes a stopped session and shows it as creating", async ({ page }) => {
    await goHome(page)

    // Find a stopped session
    const stoppedCard = page.locator("text=stopped").first()
    const hasStoppedSession = (await stoppedCard.count()) > 0

    if (!hasStoppedSession) {
      test.skip()
      return
    }

    // Click Resume on the first stopped session
    const resumeBtn = page.getByRole("button", { name: "Resume" }).first()
    await resumeBtn.click()

    // After resume, the session should transition to creating (and become a link)
    await expect(page.getByText("creating")).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("terminate session", () => {
  test("removes session from list after termination", async ({ page }) => {
    await goHome(page)

    // Count sessions before
    const before = await page.getByRole("button", { name: "Terminate" }).count()
    if (before === 0) {
      test.skip()
      return
    }

    // Note the session branch name before terminating
    const firstCard = page.locator('[class*="rounded-lg"]').first()
    const branchText = await firstCard.locator("p").nth(1).textContent()

    await page.getByRole("button", { name: "Terminate" }).first().click()

    // Session should disappear from list
    const after = await page.getByRole("button", { name: "Terminate" }).count()
    expect(after).toBe(before - 1)

    // The specific branch should no longer appear
    if (branchText) {
      const branchName = branchText.split(" · ")[0]
      await expect(page.getByText(branchName, { exact: true })).not.toBeVisible()
    }
  })
})
