import { describe, it, expect } from "bun:test"
import { buildSessionKey, type ValidationErrors } from "./setup-form-utils"

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
