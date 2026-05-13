#!/bin/sh
# Register skills from ~/.config/opencode/ with @codemcp/skills-server.
# Must cd to the config dir so experimental_install reads the correct skills-lock.json.
# Runs on every pod start (idempotent — no-op for already-installed skills).
cd "$HOME/.config/opencode" && npx -y @codemcp/skills experimental_install --yes
