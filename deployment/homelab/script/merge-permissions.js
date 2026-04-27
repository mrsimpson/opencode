#!/usr/bin/env node
/**
 * Merge agent permissions with base permissions.
 * Writes merged permissions back into each agent .md file's frontmatter.
 *
 * Usage: node merge-permissions.js /path/to/config-dir
 */
const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")

const CONFIG_DIR = process.argv[2] || path.join(__dirname, "../images/opencode/config")
const BASE_PERMS_FILE = path.join(CONFIG_DIR, "base-permissions.yaml")
const AGENTS_DIR = path.join(CONFIG_DIR, "agents")

// Extract YAML frontmatter from a markdown file (content between first and second ---)
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match ? match[1] : ""
}

// Replace the frontmatter in a markdown file
function replaceFrontmatter(content, newFrontmatter) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFrontmatter}\n---`)
}

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

// Main
const base = yaml.load(fs.readFileSync(BASE_PERMS_FILE, "utf8"))
const basePermissions = base.permission

let count = 0
for (const file of fs.readdirSync(AGENTS_DIR)) {
  if (!file.endsWith(".md")) continue

  const agentPath = path.join(AGENTS_DIR, file)
  const content = fs.readFileSync(agentPath, "utf8")
  const frontmatter = extractFrontmatter(content)
  const doc = yaml.load(frontmatter)

  const permissions = doc.permission || {}
  const merged = deepMerge(basePermissions, permissions)

  // Write merged frontmatter back into the .md file
  const newFrontmatter = yaml.dump(
    { name: doc.name, description: doc.description, permission: merged },
    { indent: 2, lineWidth: -1 },
  )
  const newContent = replaceFrontmatter(content, newFrontmatter)

  fs.writeFileSync(agentPath, newContent)
  count++
}

console.log(`Merged base permissions into ${count} agent files`)
