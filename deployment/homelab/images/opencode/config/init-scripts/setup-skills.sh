#!/bin/sh
# Post-init: register skills from ~/.config/opencode/skills/ with @codemcp/skills-server.
# Runs once after config-init seeds the config directory on first pod start.
npx -y @codemcp/skills experimental_install
