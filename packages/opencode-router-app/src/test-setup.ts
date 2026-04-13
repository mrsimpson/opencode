// Preload: stub solid-js/web with browser-compatible no-ops so tests that
// only exercise pure logic (like buildSessionKey) can import .tsx files without
// triggering the "Client-only API called on the server side" error.
import { mock } from "bun:test"

// Stub the functions that @kobalte/core calls at module-evaluation time.
mock.module("solid-js/web", () => {
  const noop = () => {}
  const noopReturn = () => ({})
  return {
    template: () => ({}),
    createComponent: noopReturn,
    effect: noop,
    setAttribute: noop,
    mergeProps: (...args: object[]) => Object.assign({}, ...args),
    spread: noop,
    classList: noop,
    style: noop,
    insert: noop,
    assign: noop,
    addEventListener: noop,
    delegateEvents: noop,
    dynamicProperty: noop,
    getNextElement: noop,
    hydrate: noop,
    render: noop,
    isServer: false,
    isDev: false,
    // pass-through for SSR helpers
    ssr: (...args: unknown[]) => args,
    escape: (v: unknown) => v,
  }
})
