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
    chmod 755 /usr/local/bin/bd /usr/local/bin/beads /usr/local/bin/gh

# Bake default config into a read-only system path.
# The config-init init container seeds /home/opencode/.config/opencode/ from
# this directory on first pod start (idempotent — skipped on restart).
COPY config/ /etc/opencode-defaults/

# Pre-install MCP servers globally so `npx -y` resolves them from cache, never the registry.
# Keep this list in sync with the `mcp` commands in config/opencode.json.
RUN npm install -g \
      @codemcp/knowledge-server \
      @codemcp/skills-server

# Non-root user matching the opencode-router pod security context (UID 1000).
RUN addgroup -S opencode && \
    adduser  -S -u 1000 -G opencode -h /home/opencode -s /bin/sh opencode && \
    chown -R opencode:opencode /home/opencode

USER opencode
ENV HOME=/home/opencode
