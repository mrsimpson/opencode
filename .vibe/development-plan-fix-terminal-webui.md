# Development Plan: opencode (fix-terminal-webui branch)

_Generated on 2026-04-28 by Vibe Feature MCP_
_Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)_

## Goal

Fix the PTY terminal in the opencode web UI within the homelab/containerized deployment. When clicking the "Terminal toggle" button, no terminal session appears and the server returns a 500 error.

## Key Decisions

### Decision 1: Root Cause — glibc vs musl incompatibility

**Date**: 2026-04-28

**Symptoms**:

- Clicking "Terminal toggle" shows an empty terminal panel — no session appears
- Server returns `500 Internal Server Error` on `POST /pty`
- Error: `TypeError: undefined is not an object (evaluating 't.symbols')` from inside the compiled Bun binary (`/$bunfs/root/chunk-*.js`)

**Diagnosis**:
The `bun-pty@0.4.8` native library (`librust_pty.so`) from the npm package is compiled for **glibc Linux** (verified via `objdump`: requires `libc.so.6`, `libdl.so.2`, `ld-linux-x86-64.so.2`, `libutil.so.1`).

The base image (`ghcr.io/anomalyco/opencode`) runs on **Alpine Linux** (musl libc). The opencode compiled binary is `opencode-linux-x64-baseline-musl` — produced by `bun build --compile` targeting musl. When `bun:ffi`'s `dlopen` tries to load the glibc-linked `librust_pty.so` on Alpine, it fails silently (caught by `catch { console.error(...) }` in bun-pty), leaving `lib = undefined`. Accessing `lib.symbols.bun_pty_spawn(...)` then throws `TypeError: undefined is not an object`.

**Base image build process** (`packages/opencode/script/build.ts`):
The build script uses `Bun.build({ compile: {...} })` targeting `bun-linux-x64-baseline-musl`. bun-pty's `terminal.ts` embeds the library via a static `require('../rust-pty/target/release/librust_pty.so')` call. Since the build runs on Linux x64, Bun statically analyses and **embeds the glibc `librust_pty.so`** from the npm package into the compiled binary. At runtime on Alpine, `BUN_PTY_LIB` can override the embedded path — but the npm package only ships glibc binaries, so the previous fix installed the wrong library.

**bun-pty library source**: https://github.com/sursaone/bun-pty (Rust, `rust-pty/Cargo.toml`). The npm package ships pre-built binaries only (no Rust source). There is no published musl variant.

**Previous fix attempt** (commit `02344a174`): Installed `bun-pty@0.4.8` via `npm install -g` and set `BUN_PTY_LIB` — but the library from the npm package is **glibc-linked** and still cannot be loaded on musl Alpine.

**Fix**: Multi-stage Dockerfile — add an Alpine builder stage that clones the bun-pty Rust source at `v0.4.8` and runs `cargo build --release`. On Alpine, cargo defaults to the `x86_64-unknown-linux-musl` target, producing a musl-compatible `librust_pty.so`. Copy it to the final image and point `BUN_PTY_LIB` at it.

### Decision 2: Why the base image doesn't include the correct library

**Date**: 2026-04-28

The `ghcr.io/anomalyco/opencode` base image is built by the **upstream** repo's `publish.yml` workflow:

- CI runner: `blacksmith-4vcpu-ubuntu-2404` (Ubuntu 24.04, **glibc**)
- Build step: `./packages/opencode/script/build.ts` → `Bun.build({ compile: ..., target: "bun-linux-x64-baseline-musl" })`
- The bun-pty module's `terminal.ts` contains `require('../rust-pty/target/release/librust_pty.so')` which Bun's static analyser detects at compile-time and **embeds into the binary**
- The file available at that path on the Ubuntu runner is the **glibc `librust_pty.so`** from the npm package
- No musl variant exists in the npm package, and the build script has no special handling for it

The resulting binary (`opencode-linux-x64-baseline-musl`) is then simply `COPY`'d into an Alpine Docker image — no library-swap step exists.

**This fork's `publish.yml` is gated on `if: github.repository == 'anomalyco/opencode'`** — meaning this fork does not run the `build-cli` job and cannot produce a corrected base binary. The only lever available is the homelab Dockerfile layer.

**Options considered**:

1. **Multi-stage Dockerfile** — Alpine builder clones bun-pty Rust source + `cargo build --release` → musl `.so` (adds ~3–5 min build time). ✅ Clean, reproducible, no committed binaries.
2. **Pre-built `.so` committed to repo** — run once in Alpine, commit result. Faster build but binary in git, must be re-run on bun-pty version bump.
3. **`gcompat`/`libc6-compat` on Alpine** — insufficient: `libutil.so.1` is not provided.
4. **Upstream fix** — modify `build.ts` to compile the Rust library for musl targets before embedding. Requires upstream contribution.

**Decision**: ~~Option 1 (multi-stage Dockerfile)~~ → **Revised to Option 2** (pre-built `.so` committed to repo) after further analysis — see Decision 3.

### Decision 3: Build approach — pre-build the .so and commit it

**Date**: 2026-04-28

**Context**: `cargo build --release` in the builder stage builds **only** the small `rust-pty` crate (~30 pure-Rust transitive deps per Cargo.lock, ~600KB output). It does NOT build opencode at all. But it still adds 3–8 minutes to every fresh Docker build environment (Rust toolchain install + dep compilation).

**Key property**: The library is version-pinned (`bun-pty@0.4.8`). It never changes unless we explicitly bump the version — making it ideal to pre-build once and check in.

**Decision**: Pre-build the musl `.so` once (using Docker/Alpine locally), commit it to `deployment/homelab/images/opencode/librust_pty_musl_amd64.so`, and have the Dockerfile `COPY` it directly. Zero Rust toolchain, zero `cargo`, zero extra build time in CI.

**Build command** (run once, or when bun-pty version bumps):

```bash
docker run --rm --platform linux/amd64 -v "$PWD":/out alpine:3 sh -c \
  "apk add --no-cache git rust cargo musl-dev && \
   git clone --depth 1 --branch v0.4.8 https://github.com/sursaone/bun-pty.git /bun-pty && \
   cd /bun-pty/rust-pty && cargo build --release && \
   cp target/release/librust_pty.so /out/deployment/homelab/images/opencode/librust_pty_musl_amd64.so"
```

**Result** (verified): `librust_pty_musl_amd64.so` — 580KB, ELF 64-bit x86-64, depends on `libc.musl-x86_64.so.1` + `libgcc_s.so.1`. The base image already installs `libgcc` via `apk add libgcc libstdc++ ripgrep`, so all dependencies are satisfied. Note: `--platform linux/amd64` required on Apple Silicon (ARM64) hosts to produce x86_64 output.

**Trade-off**: ~580KB binary in git. Acceptable: small, infrequently updated, no runtime toolchain needed. ARM64 variant can be added later if arm64 pods are needed.

## Notes

- The opencode-router proxies session subdomain requests (`{hash}.localhost:3002`) to the opencode pod via `kubectl port-forward` (dev) or direct pod IP (prod).
- The `BUN_PTY_LIB` env var mechanism is correct — bun-pty checks it first in `resolveLibPath()`. The fix is purely about providing a **musl-compatible** binary at that path.
- `libc6-compat` / `gcompat` on Alpine are insufficient: the library also requires `libutil.so.1` which has no musl wrapper in those Alpine compat packages.
- The CSP error (inline script blocked) is a separate minor issue in the iframe theme-preload script — not related to the terminal bug.
- The bun-pty npm package ships pre-built binaries only (no Rust source). The Rust source is at https://github.com/sursaone/bun-pty — must be cloned to compile.

## Reproduce

<!-- beads-phase-id: opencode-7.1 -->

### Tasks

<!-- beads-synced: 2026-04-28 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

- [ ] `opencode-7.1.1` Reproduce: document root cause - glibc vs musl incompatibility

## Analyze

<!-- beads-phase-id: opencode-7.2 -->

### Tasks

<!-- beads-synced: 2026-04-28 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Fix

<!-- beads-phase-id: opencode-7.3 -->

### Tasks

<!-- beads-synced: 2026-04-28 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Verify

<!-- beads-phase-id: opencode-7.4 -->

### Tasks

<!-- beads-synced: 2026-04-28 -->

_Auto-synced — do not edit here, use `bd` CLI instead._

## Finalize

<!-- beads-phase-id: opencode-7.5 -->

### Tasks

<!-- beads-synced: 2026-04-28 -->

_Auto-synced — do not edit here, use `bd` CLI instead._
