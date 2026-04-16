---
name: starting-project
description: Conventions and tooling to expect when starting a new project
---

# Starting a New Project

## Project Setup
- Check for an existing README, architecture doc, or requirements doc before doing anything else
- Prefer monorepo tooling (pnpm workspaces, nx, turborepo) for multi-package projects
- Use a `.editorconfig` and a linter/formatter config (ESLint + Prettier, Biome, etc.) from day one
- Store secrets in environment variables — never commit them; provide a `.env.example`

## Conventions
- Follow the language/framework conventions already present in the project
- If no conventions exist yet, propose them and document them before writing code
- Prefer explicit over implicit: clear naming, documented interfaces, typed APIs

## First Steps Checklist
1. Read all existing documentation
2. Understand the intended architecture (ask if unclear)
3. Confirm the tech stack and tooling
4. Set up the development environment and verify it works
5. Identify and create the initial project skeleton if needed
