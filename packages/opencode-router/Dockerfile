# Stage 1: Build the setup UI SPA
FROM oven/bun:1 AS spa-build
WORKDIR /monorepo
COPY package.json bun.lock ./
COPY packages/opencode-router-app/package.json packages/opencode-router-app/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile
COPY packages/ui/ packages/ui/
COPY packages/opencode-router-app/ packages/opencode-router-app/
RUN bun --cwd packages/opencode-router-app run build

# Stage 2: Build the router
FROM node:22-alpine AS router-build
WORKDIR /app
COPY packages/opencode-router/package.json packages/opencode-router/package-lock.json ./
RUN npm ci
COPY packages/opencode-router/tsconfig.json ./
COPY packages/opencode-router/src/ ./src/
RUN npx tsc

# Stage 3: Final image
FROM node:22-alpine
WORKDIR /app
COPY packages/opencode-router/package.json packages/opencode-router/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=router-build /app/dist ./dist
COPY --from=spa-build /monorepo/packages/opencode-router-app/dist ./public
EXPOSE 3000
USER 1000
CMD ["node", "dist/index.js"]
