# BASE_VERSION is read from .base-version by CI and updated by the upstream-merge workflow.
# Locally defaults to "latest" — override with: docker build --build-arg BASE_VERSION=0.0.0-dev-202604140703
ARG BASE_VERSION=latest
FROM ghcr.io/anomalyco/opencode:${BASE_VERSION}

# Install tools as root before switching to the non-root user:
#   git, curl, bash  — essential dev tools
#   nodejs, npm      — Node.js LTS + npm (latest from Alpine apk)
#   pnpm             — fast Node package manager
#   python3          — Python interpreter (for MCP servers, scripts)
#   gh               — GitHub CLI (linux/amd64 tarball from GitHub releases)
#   bd               — beads task-management CLI (https://github.com/steveyegge/beads)
#   bun              — fast typescript toolchain

RUN apk add --no-cache git curl bash nodejs npm pnpm python3 jq && \
    # gh CLI — resolve latest version tag, fetch and extract just the binary
    GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
      | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/') && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_amd64/bin/gh" && \
    # bd (beads) — installs directly to /usr/local/bin/bd
    curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash && \
    # Ensure all installed binaries are owned by root and world-executable
    chown root:root /usr/local/bin/bd /usr/local/bin/beads /usr/local/bin/gh && \
    chmod 755 /usr/local/bin/bd /usr/local/bin/beads /usr/local/bin/gh && \
    # bun — install then move binary to a system-wide path so all users can access it
    curl -fsSL https://bun.sh/install | bash && \
    mv /root/.bun/bin/bun /usr/local/bin/bun

# Bake default config into a read-only system path.
# The config-init init container seeds /home/opencode/.config/opencode/ from
# this directory on first pod start (idempotent — skipped on restart).
COPY images/opencode/config/ /etc/opencode-defaults/

# Pre-install MCP servers globally so `npx -y` resolves them from cache, never the registry.
# Keep this list in sync with the `mcp` commands in config/opencode.json.
RUN npm install -g \
      @codemcp/knowledge-server \
      @codemcp/skills-server \
      @playwright/cli@latest \
      js-yaml

# Merge agent permissions with base permissions (build time only).
# base-permissions.yaml provides defaults; agent files add overrides.
# Output: permissions.json — merged config per agent.
# js-yaml must be installed (above) before this runs.
COPY script/merge-permissions.js /tmp/merge-permissions.js
RUN NODE_PATH=$(npm root -g) node /tmp/merge-permissions.js /etc/opencode-defaults && rm /tmp/merge-permissions.js

# Install the musl-compiled librust_pty.so so bun-pty works on Alpine.
# The upstream npm package ships only glibc binaries; this pre-built .so was
# compiled from bun-pty v0.4.8 Rust source inside an Alpine container (musl).
# To rebuild: see Decision 3 in .vibe/development-plan-fix-terminal-webui.md
RUN mkdir -p /usr/local/lib/bun-pty
COPY images/opencode/librust_pty_musl_amd64.so /usr/local/lib/bun-pty/librust_pty.so

# Set BUN_PTY_LIB so bun-pty resolves the musl-compatible library at runtime
ENV BUN_PTY_LIB=/usr/local/lib/bun-pty/librust_pty.so

# Non-root user matching the opencode-router pod security context (UID 1000).
RUN addgroup -S opencode && \
    adduser  -S -u 1000 -G opencode -h /home/opencode -s /bin/sh opencode && \
    chown -R opencode:opencode /home/opencode && \
    # Ensure opencode user can read the PTY library
    chmod 644 /usr/local/lib/bun-pty/librust_pty.so

USER opencode
ENV HOME=/home/opencode
