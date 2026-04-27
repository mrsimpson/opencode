import { describe, it, expect } from "vitest"
import yaml from "js-yaml"
import fs from "fs"
import path from "path"

// Re-implement deepMerge for testing without side effects
function deepMerge(base, agent) {
  const result = JSON.parse(JSON.stringify(base))
  for (const [key, value] of Object.entries(agent)) {
    if (value === undefined) continue
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      result[key] = value
      continue
    }
    const existing = result[key]
    if (typeof existing === "object" && !Array.isArray(existing) && existing !== null) {
      result[key] = deepMerge(existing, value)
    } else {
      result[key] = value
    }
  }
  return result
}

// Extract YAML frontmatter from a markdown file
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match ? match[1] : ""
}

describe("merge-permissions", () => {
  const configDir = path.join(__dirname, "../images/opencode/config")
  const baseFile = path.join(configDir, "base-permissions.yaml")
  const agentsDir = path.join(configDir, "agents")

  const base = yaml.load(fs.readFileSync(baseFile, "utf8")).permission

  it("merges base permissions into each agent", () => {
    const agents = {}
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue
      const content = fs.readFileSync(path.join(agentsDir, file), "utf8")
      const doc = yaml.load(extractFrontmatter(content))
      const name = doc.name || file.replace(".md", "")
      agents[name] = deepMerge(base, doc.permission || {})
    }

    // All agents should have base permissions
    for (const perms of Object.values(agents)) {
      expect(perms.bash["*"]).toBe("allow")
      expect(perms.bash["rm -rf *"]).toBe("deny")
      expect(perms.bash["curl *"]).toBe("ask")
    }
  })

  it("does not override agent-specific permissions with base", () => {
    const agents = {}
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue
      const content = fs.readFileSync(path.join(agentsDir, file), "utf8")
      const doc = yaml.load(extractFrontmatter(content))
      const name = doc.name || file.replace(".md", "")
      agents[name] = deepMerge(base, doc.permission || {})
    }

    // workflow has custom "start_development": "ask"
    expect(agents.workflow["start_development"]).toBe("ask")
    expect(agents.workflow["proceed_to_phase"]).toBe("ask")
    expect(agents.workflow["conduct_review"]).toBe("allow")

    // ade has custom skilled_workflows_*
    expect(agents.ade["skilled_workflows_whats_next"]).toBe("allow")
    expect(agents.ade["skilled_workflows_conduct_review"]).toBe("allow")

    // office has custom office_workflows_*
    expect(agents.office["office_workflows_whats_next"]).toBe("allow")

    // vibe has custom vibe_workflows_*
    expect(agents.vibe["vibe_workflows_whats_next"]).toBe("allow")

    // architecture has custom architecture_workflows_*
    expect(agents.architecture["architecture_workflows_whats_next"]).toBe("allow")
  })

  it("deep merges nested bash rules", () => {
    const agent = {
      name: "test",
      permission: {
        bash: {
          "custom_cmd *": "allow",
        },
      },
    }
    const merged = deepMerge(base, agent.permission)

    // Agent-specific should be added
    expect(merged.bash["custom_cmd *"]).toBe("allow")
    // Base should still be present
    expect(merged.bash["rm -rf *"]).toBe("deny")
    expect(merged.bash["*"]).toBe("allow")
  })

  it("deep merges nested read rules", () => {
    const agent = {
      name: "test",
      permission: {
        read: {
          "custom.*": "allow",
        },
      },
    }
    const merged = deepMerge(base, agent.permission)

    expect(merged.read["custom.*"]).toBe("allow")
    expect(merged.read["*.env"]).toBe("deny")
    expect(merged.read["*"]).toBe("allow")
  })
})
