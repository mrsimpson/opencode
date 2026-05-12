import { describe, it, expect } from "bun:test"
import { buildNewProjectKey, buildSessionKey, type ValidationErrors } from "./setup-form-utils"

const errors: ValidationErrors = {
  repoUrlRequired: "Repository URL is required",
  repoUrlInvalid: "Enter a valid HTTP(S) repository URL",
  sourceBranchRequired: "Source branch is required",
}

describe("buildSessionKey", () => {
  it("returns valid with sourceBranch for a good URL and source branch", () => {
    const result = buildSessionKey("https://github.com/org/repo.git", "main", errors)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.repoUrl).toBe("https://github.com/org/repo.git")
      expect(result.sourceBranch).toBe("main")
    }
  })

  it("trims whitespace from inputs", () => {
    const result = buildSessionKey("  https://github.com/org/repo  ", "  main  ", errors)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.repoUrl).toBe("https://github.com/org/repo")
      expect(result.sourceBranch).toBe("main")
    }
  })

  it("returns error when repoUrl is empty", () => {
    const result = buildSessionKey("", "main", errors)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("required")
  })

  it("returns error for invalid URL format", () => {
    const result = buildSessionKey("not-a-url", "main", errors)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("valid")
  })

  it("returns error when source branch is empty", () => {
    const result = buildSessionKey("https://github.com/org/repo.git", "", errors)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("required")
  })
})

describe("buildNewProjectKey", () => {
  it("returns valid with promptText for non-empty prompt", () => {
    const result = buildNewProjectKey("Build me a new app")
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.promptText).toBe("Build me a new app")
    }
  })

  it("trims whitespace from prompt text", () => {
    const result = buildNewProjectKey("  Build me a new app  ")
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.promptText).toBe("Build me a new app")
    }
  })

  it("returns error when prompt text is empty", () => {
    const result = buildNewProjectKey("")
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("Describe")
  })

  it("returns error when prompt text is only whitespace", () => {
    const result = buildNewProjectKey("   ")
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("Describe")
  })
})
