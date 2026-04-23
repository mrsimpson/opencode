# Stage 1: Build the setup UI SPA
FROM oven/bun:1 AS spa-build
WORKDIR /monorepo
COPY package.json bun.lock bunfig.toml ./
# Copy ALL workspace package.json files so bun can resolve the workspace lockfile
COPY packages/app/package.json packages/app/
COPY packages/console/app/package.json packages/console/app/
COPY packages/console/core/package.json packages/console/core/
COPY packages/console/function/package.json packages/console/function/
COPY packages/console/mail/package.json packages/console/mail/
COPY packages/console/resource/package.json packages/console/resource/
COPY packages/desktop/package.json packages/desktop/
COPY packages/desktop-electron/package.json packages/desktop-electron/
COPY packages/enterprise/package.json packages/enterprise/
COPY packages/function/package.json packages/function/
COPY packages/opencode/package.json packages/opencode/
COPY packages/opencode-router/package.json packages/opencode-router/
COPY packages/opencode-router-app/package.json packages/opencode-router-app/
COPY packages/plugin/package.json packages/plugin/
COPY packages/script/package.json packages/script/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/shared/package.json packages/shared/
COPY packages/slack/package.json packages/slack/
COPY packages/storybook/package.json packages/storybook/
COPY packages/ui/package.json packages/ui/
COPY packages/util/package.json packages/util/
COPY packages/web/package.json packages/web/
COPY patches/ patches/
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/ui/ packages/ui/
COPY packages/opencode-router-app/ packages/opencode-router-app/
RUN bun run --cwd packages/opencode-router-app build

# Stage 2: Build the router
# Use bun (the monorepo package manager) — no package-lock.json exists
FROM oven/bun:1 AS router-build
WORKDIR /monorepo
COPY package.json bun.lock bunfig.toml ./
# Copy ALL workspace package.json files so bun can resolve the workspace lockfile
COPY packages/app/package.json packages/app/
COPY packages/console/app/package.json packages/console/app/
COPY packages/console/core/package.json packages/console/core/
COPY packages/console/function/package.json packages/console/function/
COPY packages/console/mail/package.json packages/console/mail/
COPY packages/console/resource/package.json packages/console/resource/
COPY packages/desktop/package.json packages/desktop/
COPY packages/desktop-electron/package.json packages/desktop-electron/
COPY packages/enterprise/package.json packages/enterprise/
COPY packages/function/package.json packages/function/
COPY packages/opencode/package.json packages/opencode/
COPY packages/opencode-router/package.json packages/opencode-router/
COPY packages/opencode-router-app/package.json packages/opencode-router-app/
COPY packages/plugin/package.json packages/plugin/
COPY packages/script/package.json packages/script/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/shared/package.json packages/shared/
COPY packages/slack/package.json packages/slack/
COPY packages/storybook/package.json packages/storybook/
COPY packages/ui/package.json packages/ui/
COPY packages/util/package.json packages/util/
COPY packages/web/package.json packages/web/
COPY patches/ patches/
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/opencode-router/tsconfig.json packages/opencode-router/
COPY packages/opencode-router/src/ packages/opencode-router/src/
RUN bun run --cwd packages/opencode-router build

# Stage 3: Final image
# Use node:22-alpine for a lean runtime; copy compiled dist + node_modules from build stage
FROM node:22-alpine
WORKDIR /app
# Copy compiled JS output
COPY --from=router-build /monorepo/packages/opencode-router/dist ./dist
# Copy package.json for runtime metadata (type:module)
COPY packages/opencode-router/package.json ./
# Copy production node_modules from bun's workspace install
COPY --from=router-build /monorepo/node_modules ./node_modules
COPY --from=spa-build /monorepo/packages/opencode-router-app/dist ./public
EXPOSE 3000
USER 1000
CMD ["node", "dist/index.js"]


