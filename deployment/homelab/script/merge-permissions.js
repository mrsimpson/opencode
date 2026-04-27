#!/usr/bin/env node
/**
 * Merge agent permissions with base permissions.
 * Output: permissions.json — one merged config per agent.
 *
 * Usage: node merge-permissions.js /path/to/config-dir
 */
const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")

const CONFIG_DIR = process.argv[2] || path.join(__dirname, "../images/opencode/config")
const BASE_PERMS_FILE = path.join(CONFIG_DIR, "base-permissions.yaml")
const AGENTS_DIR = path.join(CONFIG_DIR, "agents")
const OUTPUT_FILE = path.join(CONFIG_DIR, "permissions.json")

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

const agents = {}
for (const file of fs.readdirSync(AGENTS_DIR)) {
  if (!file.endsWith(".md")) continue

  const agentPath = path.join(AGENTS_DIR, file)
  const doc = yaml.load(fs.readFileSync(agentPath, "utf8"))

  const name = doc.name || file.replace(".md", "")
  const permissions = doc.permission || {}

  agents[name] = deepMerge(basePermissions, permissions)
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(agents, null, 2))
console.log(`Merged permissions for ${Object.keys(agents).length} agents → ${OUTPUT_FILE}`)
