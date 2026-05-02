import { describe, it, expect, beforeEach, mock } from "bun:test"

// Set env so pushEvent's fetch path actually runs. Tests inspect the captured
// fetch calls to know which events were pushed.
process.env.OPENCODE_ROUTER_URL = "http://router.test"
process.env.OPENCODE_SESSION_HASH = "abc123456789"
process.env.OPENCODE_POD_SECRET = "secret"

const fetchCalls: { url: string; body: any }[] = []
const fetchMock = mock((url: string, init?: RequestInit) => {
  fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
  return Promise.resolve({ ok: true } as Response)
})
globalThis.fetch = fetchMock as any

const mod = await import("./index.js")
const RouterPlugin = mod.default.server
const __test = mod.__test

beforeEach(() => {
  __test.reset()
  fetchCalls.length = 0
  fetchMock.mockClear()
})

function fakeInput(sessions: { id: string; title?: string; messages?: any[] }[] = []) {
  return {
    client: {
      session: {
        list: () => Promise.resolve({ data: sessions }),
        messages: ({ path }: { path: { id: string } }) =>
          Promise.resolve({
            data: sessions.find((s) => s.id === path.id)?.messages ?? [],
          }),
      },
    },
  } as any
}

const pushedTypes = () => fetchCalls.map((c) => c.body?.type)
const pushedSessionIds = () => fetchCalls.map((c) => c.body?.sessionID)

describe("startup replay sets allowedSessionIds", () => {
  it("empty replay → allowedSessionIds stays null (accept-all on a fresh pod)", async () => {
    await __test.runStartupReplay(fakeInput([]))
    expect(__test.getAllowedSessionIds()).toBe(null)
    expect(__test.isAllowed("any-id")).toBe(true)
  })

  it("non-empty replay → allowedSessionIds is the set of replayed session IDs", async () => {
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }, { id: "sess-B" }]))
    expect(__test.getAllowedSessionIds()).toEqual(new Set(["sess-A", "sess-B"]))
    expect(__test.isAllowed("sess-A")).toBe(true)
    expect(__test.isAllowed("sess-B")).toBe(true)
    expect(__test.isAllowed("sess-C")).toBe(false)
  })

  it("replay with a title pushes session.title to the router", async () => {
    await __test.runStartupReplay(fakeInput([{ id: "sess-A", title: "Hello" }]))
    expect(fetchCalls.find((c) => c.body?.type === "session.title")).toBeDefined()
    expect(fetchCalls[0].body.title).toBe("Hello")
  })
})

describe("session.created locks allowedSessionIds on a fresh pod", () => {
  it("from null state, the first session.created sets allowedSessionIds to that one ID", async () => {
    const hooks = await RouterPlugin(fakeInput([]))
    expect(__test.getAllowedSessionIds()).toBe(null) // setTimeout hasn't fired

    await hooks.event({
      event: { type: "session.created", properties: { info: { id: "sess-bootstrap", title: "T" } } } as any,
    } as any)

    expect(__test.getAllowedSessionIds()).toEqual(new Set(["sess-bootstrap"]))
  })

  it("after lock, events for the locked session are pushed", async () => {
    const hooks = await RouterPlugin(fakeInput([]))
    await hooks.event({
      event: { type: "session.created", properties: { info: { id: "sess-A", title: "Title-A" } } } as any,
    } as any)

    expect(pushedTypes()).toContain("session.title")
    expect(pushedSessionIds()).toContain("sess-A")
  })

  it("on a resumed pod, allowedSessionIds was populated by replay; new session.created adds (does not reset) the set", async () => {
    // Replay populates the set with sess-A
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }]))
    expect(__test.getAllowedSessionIds()).toEqual(new Set(["sess-A"]))

    const hooks = await RouterPlugin(fakeInput([{ id: "sess-A" }]))
    await hooks.event({
      event: { type: "session.created", properties: { info: { id: "sess-B", title: "T" } } } as any,
    } as any)

    // sess-A from replay is preserved; sess-B is added by lockToSession's idempotent branch
    expect(__test.getAllowedSessionIds()).toEqual(new Set(["sess-A", "sess-B"]))
  })
})

describe("event hook respects allowedSessionIds", () => {
  it("user message events for a not-allowed session are dropped", async () => {
    // Lock to sess-A only
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }]))
    fetchCalls.length = 0 // discard replay's title pushes (none here, but be safe)

    const hooks = await RouterPlugin(fakeInput([{ id: "sess-A" }]))

    // Cache role for the message
    await hooks.event({
      event: { type: "message.updated", properties: { info: { id: "msg-X", role: "user" } } } as any,
    } as any)

    // Fire message.part.updated for a session that is NOT in allowedSessionIds
    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: { id: "part-1", type: "text", messageID: "msg-X", sessionID: "sess-FOREIGN", text: "hi" },
        },
      } as any,
    } as any)

    expect(fetchCalls).toHaveLength(0)
  })

  it("user message events for an allowed session are pushed", async () => {
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }]))
    fetchCalls.length = 0

    const hooks = await RouterPlugin(fakeInput([{ id: "sess-A" }]))

    await hooks.event({
      event: { type: "message.updated", properties: { info: { id: "msg-X", role: "user" } } } as any,
    } as any)

    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: { id: "part-1", type: "text", messageID: "msg-X", sessionID: "sess-A", text: "hi" },
          time: 1234,
        },
      } as any,
    } as any)

    expect(pushedTypes()).toEqual(["message.user"])
    expect(fetchCalls[0].body).toMatchObject({
      type: "message.user",
      partID: "part-1",
      messageID: "msg-X",
      sessionID: "sess-A",
      text: "hi",
      time: 1234,
    })
  })

  it("experimental.text.complete drops events for not-allowed sessions", async () => {
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }]))
    fetchCalls.length = 0

    const hooks = await RouterPlugin(fakeInput([{ id: "sess-A" }]))

    await hooks["experimental.text.complete"](
      { sessionID: "sess-FOREIGN", messageID: "m1", partID: "p1" } as any,
      { text: "out" } as any,
    )

    expect(fetchCalls).toHaveLength(0)
  })

  it("experimental.text.complete pushes message.assistant for allowed sessions", async () => {
    await __test.runStartupReplay(fakeInput([{ id: "sess-A" }]))
    fetchCalls.length = 0

    const hooks = await RouterPlugin(fakeInput([{ id: "sess-A" }]))

    await hooks["experimental.text.complete"](
      { sessionID: "sess-A", messageID: "m1", partID: "p1" } as any,
      { text: "out" } as any,
    )

    expect(pushedTypes()).toEqual(["message.assistant"])
    expect(fetchCalls[0].body).toMatchObject({
      type: "message.assistant",
      partID: "p1",
      messageID: "m1",
      sessionID: "sess-A",
      text: "out",
    })
  })
})
