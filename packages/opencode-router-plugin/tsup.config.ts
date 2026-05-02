import { defineConfig } from "tsup"

// The build output `dist/index.js` is mounted into opencode pods via ConfigMap
// and loaded by bun at runtime. It MUST be self-contained — nothing in the pod
// resolves `@opencode-ai/*` packages at runtime. `noExternal: [/.*/]` forces
// every value-level import to be inlined, so any future regression that adds
// a runtime dependency will be caught at build time rather than at pod start.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  noExternal: [/.*/],
  clean: true,
  splitting: false,
})
