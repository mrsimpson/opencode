import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod/v4"
import { data } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      tool_call: z.boolean(),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      }),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      experimental: z.boolean().optional(),
      options: z.record(z.string(), z.any()),
      provider: z.object({ npm: z.string() }).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Provider = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    refresh()
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    const providers = result ? (result as Record<string, Provider>) : (JSON.parse(await data()) as Record<string, Provider>)

    // Add Amazon Q provider if not in database
    if (!providers["amazon-q"]) {
      providers["amazon-q"] = {
        id: "amazon-q",
        name: "Amazon Q Developer",
        env: [],
        models: {
          "amazon-q-developer": {
            id: "amazon-q-developer",
            name: "Amazon Q Developer",
            release_date: "2024-01-01",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            cost: {
              input: 0,
              output: 0,
              cache_read: 0,
              cache_write: 0,
            },
            limit: {
              context: 100000,
              output: 4096,
            },
            options: {},
          },
        },
      }
    }

    return providers
  }

  export async function refresh() {
    const file = Bun.file(filepath)
    log.info("refreshing", {
      file,
    })
    const result = await fetch("https://models.dev/api.json", {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) await Bun.write(file, await result.text())
  }
}

setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
