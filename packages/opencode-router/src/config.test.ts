import { describe, it, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

describe("config defaults", () => {
  it("idleTimeoutMinutes defaults to 15", () => {
    const { IDLE_TIMEOUT_MINUTES: _, ...rest } = process.env
    const env = { ...rest, OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.idleTimeoutMinutes)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dir, "..") },
    )
    expect(result.stdout.trim()).toBe("15")
  })
})
